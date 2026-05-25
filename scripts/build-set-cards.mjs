#!/usr/bin/env node
// @ts-check
/**
 * Pre-fetch every Scryfall set's card pool that the site ever needs at
 * runtime and dump trimmed JSONs to `data/set-cards/<code>.json`. The
 * runtime (lib/scryfall.ts) reads these from disk first and only falls
 * back to live Scryfall fetches for sets the script hasn't covered yet
 * (e.g. a brand-new set added between script runs).
 *
 * Why: cold page renders for big sets paginate Scryfall 3–8 times and
 * can take 20–30 seconds. Pre-baking turns those into ~5ms local disk
 * reads. Trade-off is repo size (~60–100MB) and a periodic re-run
 * cadence (~monthly, or whenever a new set drops).
 *
 * Usage:
 *   node scripts/build-set-cards.mjs                  # refresh every set
 *   node scripts/build-set-cards.mjs sos blb tsos     # refresh specific codes
 *   node scripts/build-set-cards.mjs --missing-only   # only fetch codes we don't have yet
 *
 * The script auto-discovers which sets to fetch:
 *   1. Every openable set (keys of data/set-art.json)
 *   2. The t<code> token set for each openable set
 *   3. Every literal set code referenced in any data/booster-contents
 *      recipe (e.g. SOS references SOA + PSOS + TSOS)
 *
 * Each card is trimmed to the same shape as lib/scryfall.ts
 * `trimCardForClient` — that drops ~60% of Scryfall's response weight
 * (oracle_text, rulings, multiverse_ids, purchase_uris, etc.). Result
 * is the JSON the route-level code would have shipped to the client
 * after `trimCardPool`, so the disk read is a drop-in replacement for
 * the live fetch from the runtime's perspective.
 */

import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "data", "set-cards");
const SET_ART_PATH = join(ROOT, "data", "set-art.json");
const BOOSTER_CONTENTS_DIR = join(ROOT, "data", "booster-contents");

const SCRYFALL = "https://api.scryfall.com";
// Single-threaded with a global pacer. Earlier we used concurrency=2
// with per-worker throttling, but each set fetch paginates 2-3 times
// and the per-worker accounting meant we could legitimately burst
// 4-6 requests/second above the supposed ceiling on long runs —
// Scryfall 429'd around the ninth set. The global pacer below
// guarantees `MIN_INTERVAL_MS` between EVERY Scryfall request,
// pagination pages included. 200ms ≈ 5 req/sec, well under
// Scryfall's 10 req/sec hard cap with comfortable headroom for
// jitter. ~225 sets × ~3 pages avg × 200ms = ~2.5 minutes minimum,
// realistically 25-40 minutes once you add response latency.
const CONCURRENCY = 1;
const MIN_INTERVAL_MS = 200;
// On 429s without a Retry-After header, fall back to this delay
// before retrying. Scryfall almost always sends Retry-After in
// seconds; this is just the safety net.
const RATE_LIMIT_FALLBACK_MS = 5000;

const args = process.argv.slice(2);
const missingOnly = args.includes("--missing-only");
const explicitCodes = args.filter((a) => !a.startsWith("--")).map((a) => a.toLowerCase());

/* ============================================================
   Set discovery
   ============================================================ */

/** Walk a nested object/array and call cb on every encountered slot
 *  outcome object (any object inside an `outcomes` array). Booster
 *  recipes nest pack-type → slots → outcomes deep enough that a
 *  generic walker is simpler than threading the recipe schema. */
function walkOutcomes(node, cb) {
  if (Array.isArray(node)) {
    for (const item of node) walkOutcomes(item, cb);
    return;
  }
  if (node && typeof node === "object") {
    if (Array.isArray(node.outcomes)) {
      for (const o of node.outcomes) cb(o);
    }
    for (const v of Object.values(node)) walkOutcomes(v, cb);
  }
}

async function discoverSetCodes() {
  const codes = new Set();
  // We explicitly track which codes were added as token sub-sets vs
  // main pools. Earlier we inferred this from `code.startsWith("t")`,
  // but several real openable sets have codes that legitimately
  // start with t — TMT, TLA, TDM, TSR, THB, TOR, TMP, THS, TSP, TSB.
  // Those got mis-classified, run through the token-only filter,
  // and silently wrote nothing. Explicit tracking is the only safe
  // way to tell "T" the prefix from "T" the first letter of a real
  // set code.
  const tokenCodes = new Set();

  // Openable sets + their token sub-sets. data/set-art.json wraps the
  // actual code map in an `art` field, with sibling metadata fields
  // (`_doc`, `generatedAt`, `setCount`) — reading top-level keys would
  // queue bogus codes like `_doc` and `tart` and waste Scryfall budget
  // on guaranteed 404s before getting rate-limited on the real ones.
  const artRaw = await readFile(SET_ART_PATH, "utf8");
  const artFile = JSON.parse(artRaw);
  const artMap = artFile?.art ?? {};
  for (const code of Object.keys(artMap)) {
    const lower = code.toLowerCase();
    codes.add(lower);
    const tokenCode = `t${lower}`;
    codes.add(tokenCode);
    tokenCodes.add(tokenCode);
  }

  // Literal set codes referenced in any recipe. Sentinels like
  // "$tokens", "$primary-set", "$own" are skipped — they resolve to
  // codes already covered by the openable-sets pass above.
  const files = await readdir(BOOSTER_CONTENTS_DIR);
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const raw = await readFile(join(BOOSTER_CONTENTS_DIR, f), "utf8");
    const data = JSON.parse(raw);
    walkOutcomes(data, (outcome) => {
      const setRef = outcome?.set;
      if (typeof setRef !== "string") return;
      if (setRef.startsWith("$")) return; // sentinel — resolved at runtime
      codes.add(setRef.toLowerCase());
    });
  }

  return { codes: [...codes].sort(), tokenCodes };
}

/* ============================================================
   Scryfall fetch + trim
   ============================================================ */

/**
 * Global pacer — every Scryfall request goes through `pacedFetch`, which
 * waits until at least MIN_INTERVAL_MS has elapsed since the previous
 * request. The pacing is global (module-scoped state) so pagination
 * pages and per-set requests share the same budget, not per-worker.
 *
 * Implementation: each call queues onto a single-slot promise chain,
 * which guarantees serialization without needing a real lock.
 */
let pacerChain = Promise.resolve();
let lastRequestAt = 0;
function paced(fn) {
  const next = pacerChain.then(async () => {
    const elapsed = Date.now() - lastRequestAt;
    if (elapsed < MIN_INTERVAL_MS) {
      await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
    }
    lastRequestAt = Date.now();
    return fn();
  });
  pacerChain = next.then(
    () => undefined,
    () => undefined, // don't poison the chain on error — next call can run
  );
  return next;
}

/**
 * Issue one Scryfall request with retry-on-429 + exponential backoff
 * on transient errors. The 429 branch reads Scryfall's `Retry-After`
 * header (seconds) and sleeps for at least that long before retrying,
 * which is what Scryfall asks every client to do. We retry 429s
 * indefinitely (well, up to `MAX_RETRIES_PER_URL`) — the whole point
 * of this script is to be safe over fast, so giving up on a 429 would
 * defeat the purpose. Other 5xx errors get up to `MAX_RETRIES_PER_URL`
 * tries with exponential backoff. 4xx-non-429 are returned as-is so
 * the caller can handle 404 (legitimately-empty token sub-set, etc.).
 */
const MAX_RETRIES_PER_URL = 8;

async function fetchWithRetry(url) {
  let attempt = 0;
  let backoffMs = 600;
  while (true) {
    attempt++;
    const res = await paced(() =>
      fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": "threetreecity-build-set-cards/1.0",
        },
      }),
    ).catch((err) => ({ networkError: err }));

    if (res.networkError) {
      if (attempt >= MAX_RETRIES_PER_URL) throw res.networkError;
      await new Promise((r) => setTimeout(r, backoffMs));
      backoffMs = Math.min(backoffMs * 2, 30_000);
      continue;
    }

    if (res.status === 429) {
      const retryAfterRaw = res.headers.get("retry-after");
      const retryAfterSec = retryAfterRaw ? Number(retryAfterRaw) : NaN;
      const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? Math.ceil(retryAfterSec * 1000) + 250 // +250ms jitter
        : RATE_LIMIT_FALLBACK_MS;
      console.warn(`  rate-limited, sleeping ${(waitMs / 1000).toFixed(1)}s before retry…`);
      await new Promise((r) => setTimeout(r, waitMs));
      // 429 retries don't count against MAX_RETRIES — Scryfall is
      // telling us to back off, not that the request is permanently
      // broken. If they keep 429ing forever that's a wider problem
      // that the user should see, but a 60-second wait is fine.
      continue;
    }

    if (res.status === 404) return { notFound: true };

    if (!res.ok) {
      if (attempt >= MAX_RETRIES_PER_URL) {
        throw new Error(`${res.status} ${res.statusText} (after ${attempt} attempts)`);
      }
      await new Promise((r) => setTimeout(r, backoffMs));
      backoffMs = Math.min(backoffMs * 2, 30_000);
      continue;
    }

    return { data: await res.json() };
  }
}

/** Paginate Scryfall's `cards/search` for one set code. Mirrors
 *  `fetchAllPages` in lib/scryfall.ts: same query shape so the resulting
 *  pool is byte-equivalent to what the live runtime would have produced.
 *  No per-page sleep here — `paced()` inside `fetchWithRetry` handles
 *  the global rate limit, and an extra sleep would just slow us down
 *  unnecessarily without making Scryfall any happier. */
async function fetchSetCards(code) {
  const q = encodeURIComponent(`set:${code} game:paper`);
  const out = [];
  let url = `${SCRYFALL}/cards/search?q=${q}&unique=prints&order=set&include_extras=false&include_variations=false&include_multilingual=true`;
  while (url) {
    const res = await fetchWithRetry(url);
    if (res.notFound) return out; // genuinely no cards (e.g. tokens for a set with no token sub-set)
    const page = res.data;
    if (Array.isArray(page?.data)) out.push(...page.data);
    url = page?.has_more && page?.next_page ? page.next_page : null;
  }
  return out;
}

/** Mirror of lib/scryfall.ts `filterPool`. Drops digital, oversized,
 *  and special layouts (tokens/emblems/schemes) — those are fetched
 *  separately as token sub-sets. */
function filterPool(cards) {
  return cards.filter(
    (c) =>
      !c.digital &&
      !c.oversized &&
      c.layout !== "token" &&
      c.layout !== "double_faced_token" &&
      c.layout !== "emblem" &&
      c.layout !== "scheme",
  );
}

/** For token sub-sets (t<code>), invert the filter: keep ONLY tokens,
 *  matching `getSetTokens` in lib/scryfall.ts. Distinguished here by
 *  the t-prefix on the code. */
function filterTokens(cards) {
  return cards.filter(
    (c) =>
      !c.digital &&
      (c.layout === "token" || c.layout === "double_faced_token" || c.layout === "emblem"),
  );
}

/** Mirror of `trimCardForClient` in lib/scryfall.ts. Keep this in sync
 *  with that function when fields are added/removed — runtime reads
 *  these JSONs and expects the same shape. */
function trimCard(c) {
  return {
    id: c.id,
    name: c.name,
    set: c.set,
    set_name: c.set_name,
    collector_number: c.collector_number,
    rarity: c.rarity,
    type_line: c.type_line,
    mana_cost: c.mana_cost,
    cmc: c.cmc,
    colors: c.colors,
    color_identity: c.color_identity,
    image_uris: c.image_uris
      ? {
          normal: c.image_uris.normal,
          large: c.image_uris.large,
          art_crop: c.image_uris.art_crop,
        }
      : undefined,
    card_faces: c.card_faces?.map((f) => ({
      name: f.name,
      mana_cost: f.mana_cost,
      type_line: f.type_line,
      image_uris: f.image_uris
        ? {
            normal: f.image_uris.normal,
            large: f.image_uris.large,
            art_crop: f.image_uris.art_crop,
          }
        : undefined,
    })),
    layout: c.layout,
    scryfall_uri: c.scryfall_uri,
    prices: c.prices
      ? {
          usd: c.prices.usd,
          usd_foil: c.prices.usd_foil,
          usd_etched: c.prices.usd_etched,
          eur: c.prices.eur,
          eur_foil: c.prices.eur_foil,
        }
      : undefined,
    artist: c.artist,
    frame_effects: c.frame_effects,
    border_color: c.border_color,
    promo_types: c.promo_types,
    produced_mana: c.produced_mana,
    lang: c.lang,
    finishes: c.finishes,
    digital: false,
    oversized: false,
    booster: c.booster,
  };
}

/* ============================================================
   Concurrency runner
   ============================================================ */

/** Bounded-concurrency runner. Pacing happens inside `paced()` at the
 *  request layer, so this just controls how many sets we're processing
 *  in parallel (each set may issue 1-3 paginated requests). With
 *  CONCURRENCY=1 this is a straight sequential loop, but the structure
 *  is preserved so we can tune it back up if Scryfall is consistently
 *  generous on a given day. */
async function runPool(items, worker, concurrency) {
  let cursor = 0;
  const inFlight = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(inFlight);
}

/* ============================================================
   Main
   ============================================================ */

async function fileExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  // Always run discover so we know which codes are token sub-sets,
  // even when the user passed explicit codes on the CLI. That lets us
  // apply the right filter (filterTokens vs filterPool) per code
  // without re-introducing the broken `startsWith("t")` heuristic.
  const discovered = await discoverSetCodes();
  const { tokenCodes } = discovered;

  let codes;
  if (explicitCodes.length) {
    codes = explicitCodes;
    console.log(`Using ${codes.length} explicit set codes from argv`);
  } else {
    codes = discovered.codes;
    console.log(`Discovered ${codes.length} set codes (openable + tokens + recipe references)`);
  }

  if (missingOnly) {
    const before = codes.length;
    const filtered = [];
    for (const c of codes) {
      const exists = await fileExists(join(OUT_DIR, `${c}.json`));
      if (!exists) filtered.push(c);
    }
    codes = filtered;
    console.log(`--missing-only: ${codes.length} of ${before} codes need fetching`);
  }

  if (codes.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  console.log(`Concurrency: ${CONCURRENCY}, min interval: ${MIN_INTERVAL_MS}ms (≤${Math.floor(1000 / MIN_INTERVAL_MS)} req/sec global)`);
  console.log("");

  const stats = { ok: 0, empty: 0, fail: 0, totalCards: 0, totalBytes: 0 };
  const t0 = Date.now();

  await runPool(
    codes,
    /** @param {string} code @param {number} idx */
    async (code, idx) => {
      // Only codes derived as `t<openable>` are treated as token-only
      // sub-sets. Codes like `tmt` (TMNT), `tla` (Avatar), `tdm`
      // (Tarkir Dragonstorm) etc. are real openable sets whose codes
      // happen to start with t — apply the regular filterPool.
      const isTokenSet = tokenCodes.has(code);
      const tag = `[${(idx + 1).toString().padStart(3)}/${codes.length}]`;
      try {
        const raw = await fetchSetCards(code);
        const filtered = isTokenSet ? filterTokens(raw) : filterPool(raw);
        if (filtered.length === 0) {
          stats.empty++;
          console.log(`${tag} ${code.padEnd(8)} empty — skipping write`);
          return;
        }
        const trimmed = filtered.map(trimCard);
        const json = JSON.stringify(trimmed);
        await writeFile(join(OUT_DIR, `${code}.json`), json, "utf8");
        stats.ok++;
        stats.totalCards += trimmed.length;
        stats.totalBytes += json.length;
        console.log(`${tag} ${code.padEnd(8)} ${trimmed.length.toString().padStart(4)} cards · ${(json.length / 1024).toFixed(1).padStart(7)} KB`);
      } catch (err) {
        stats.fail++;
        console.error(`${tag} ${code.padEnd(8)} FAILED — ${err.message ?? err}`);
      }
    },
    CONCURRENCY,
  );

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("");
  console.log(`Done in ${secs}s — ${stats.ok} ok, ${stats.empty} empty, ${stats.fail} failed`);
  console.log(`Total: ${stats.totalCards.toLocaleString()} cards across ${stats.ok} files, ${(stats.totalBytes / 1024 / 1024).toFixed(1)} MB on disk`);
  if (stats.fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Build crashed:", err);
  process.exit(1);
});
