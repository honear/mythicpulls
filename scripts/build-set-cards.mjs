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
 *   node scripts/build-set-cards.mjs                  # BULK mode: download Scryfall's
 *                                                     # daily all-cards bulk file once
 *                                                     # (unlimited *.scryfall.io origin)
 *                                                     # and build every pool locally
 *   node scripts/build-set-cards.mjs sos blb tsos     # API mode: refresh specific codes
 *                                                     # via /cards/search (paced 600ms —
 *                                                     # the endpoint's hard limit is 2/s)
 *   node scripts/build-set-cards.mjs --missing-only   # API mode, only missing codes
 *   node scripts/build-set-cards.mjs --resume-after X # API mode, resume a crashed run
 *
 * Scryfall's rate-limit docs are explicit that bulk pulls "must use the
 * bulk data files" — full-catalog runs against /cards/search burned the
 * 2/s budget (≈1,200 paginated calls) and drew 429 streaks. Bulk mode is
 * one ~2.4 GB download + a few minutes of local stream-parse.
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

import { readFile, writeFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "data", "set-cards");
const SET_ART_PATH = join(ROOT, "data", "set-art.json");
const BOOSTER_CONTENTS_DIR = join(ROOT, "data", "booster-contents");

const SCRYFALL = "https://api.scryfall.com";
// Single-threaded with a global pacer. Scryfall's documented limits
// (https://scryfall.com/docs/api/rate-limits) are 2/second (500ms) for
// /cards/search — which is the ONLY endpoint this script's API mode
// hits — and 10/second for everything else. We pace at 600ms for
// headroom. NOTE: per those same docs, large pulls "must use the bulk
// data files" — which is what the default bulk mode below does; API
// mode exists only for quick single-set refreshes (a handful of
// requests).
const CONCURRENCY = 1;
const MIN_INTERVAL_MS = 600;
// On 429s without a Retry-After header, fall back to this delay
// before retrying. Scryfall almost always sends Retry-After in
// seconds; this is just the safety net.
const RATE_LIMIT_FALLBACK_MS = 5000;

const args = process.argv.slice(2);
const missingOnly = args.includes("--missing-only");
// --resume-after <code>: skip every code at or before <code> in the
// discover-sorted order. For resuming a crashed/hung full run without
// re-fetching what already completed (codes process alphabetically).
const resumeIdx = args.indexOf("--resume-after");
const resumeAfter = resumeIdx >= 0 ? (args[resumeIdx + 1] ?? "").toLowerCase() : null;
const explicitCodes = args
  .filter((a, i) => !a.startsWith("--") && i !== resumeIdx + 1)
  .map((a) => a.toLowerCase());

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
  // codes already covered by the openable-sets pass above. The recipe
  // FILENAME is also a code: a set below the openable threshold (ARN)
  // or excluded by set_type (UGL/UST) can still have a recipe whose
  // outcomes reference their own set implicitly — without this, those
  // pools never bake and the recipes silently fall back.
  const files = await readdir(BOOSTER_CONTENTS_DIR);
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    if (f !== "default.json") {
      const own = f.replace(".json", "").toLowerCase();
      codes.add(own);
      const tokenCode = `t${own}`;
      codes.add(tokenCode);
      tokenCodes.add(tokenCode);
    }
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
// Hard cap on consecutive 429 retries per URL. 429s are normally worth
// waiting out (Retry-After), but a network-level block answers EVERY
// request with 429 — without a cap the run waits forever on one URL.
const MAX_RATE_LIMIT_RETRIES = 10;
// Per-request hard timeout. Native fetch has NO default timeout, so a
// dead TCP connection (server silently dropping us mid-handshake) left
// the promise pending forever and wedged the global pacer chain behind
// it — a 6-hour hang in production. Aborts surface as retryable
// network errors below.
const REQUEST_TIMEOUT_MS = 30_000;

async function fetchWithRetry(url) {
  let attempt = 0;
  let rateLimitHits = 0;
  let backoffMs = 600;
  while (true) {
    attempt++;
    const res = await paced(() =>
      fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": "threetreecity-build-set-cards/1.0",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }),
    ).catch((err) => ({ networkError: err }));

    if (res.networkError) {
      if (attempt >= MAX_RETRIES_PER_URL) throw res.networkError;
      await new Promise((r) => setTimeout(r, backoffMs));
      backoffMs = Math.min(backoffMs * 2, 30_000);
      continue;
    }

    if (res.status === 429) {
      rateLimitHits++;
      if (rateLimitHits > MAX_RATE_LIMIT_RETRIES) {
        throw new Error(`429 persisted through ${MAX_RATE_LIMIT_RETRIES} retries — likely a network-level block; failing this set so the run can continue`);
      }
      const retryAfterRaw = res.headers.get("retry-after");
      const retryAfterSec = retryAfterRaw ? Number(retryAfterRaw) : NaN;
      const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? Math.ceil(retryAfterSec * 1000) + 250 // +250ms jitter
        : RATE_LIMIT_FALLBACK_MS;
      console.warn(`  rate-limited (${rateLimitHits}/${MAX_RATE_LIMIT_RETRIES}), sleeping ${(waitMs / 1000).toFixed(1)}s before retry…`);
      await new Promise((r) => setTimeout(r, waitMs));
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
 *  unnecessarily without making Scryfall any happier.
 *
 *  Token sub-sets drop the `game:paper` term and turn extras on: art
 *  cards and helper cards are not game pieces, so `game:paper` filters
 *  them out (tmsh: 6 cards with the term vs 27 without). Collector
 *  recipes' "Art Card / Token" slots (gold_stamped filter etc.) need
 *  those art cards in the pool. */
async function fetchSetCards(code, isTokenSet = false) {
  const q = encodeURIComponent(isTokenSet ? `set:${code}` : `set:${code} game:paper`);
  const extras = isTokenSet ? "true" : "false";
  const out = [];
  let url = `${SCRYFALL}/cards/search?q=${q}&unique=prints&order=set&include_extras=${extras}&include_variations=false&include_multilingual=true`;
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
    // `frame` + `full_art` power the retro_frame / future_frame /
    // full_art / full_art_basic / non_full_art_basic filters. They were
    // missing from this mirror for a while (lib/scryfall.ts had them,
    // this copy didn't), which silently emptied every retro-frame and
    // full-art-land outcome rolled against baked pools — the engine
    // fell back to regular prints with no error. Keep this list in
    // EXACT sync with trimCardForClient in lib/scryfall.ts.
    frame: c.frame,
    full_art: c.full_art,
    variation: c.variation,
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
   Bulk-data pipeline (default mode)
   ============================================================ */

/**
 * Stream-parse a multi-GB JSON file shaped as one top-level array of
 * objects, invoking `onObject(parsed)` per element without ever holding
 * the whole file in memory. A simple scanner tracks string/escape state
 * and brace depth; each depth-1 object is sliced and JSON.parsed.
 */
async function streamJsonArray(filePath, onObject) {
  const stream = createReadStream(filePath, { encoding: "utf8", highWaterMark: 8 * 1024 * 1024 });
  let buf = "";
  let depth = 0;
  let inString = false;
  let escape = false;
  let objStart = -1;
  let count = 0;
  for await (const chunk of stream) {
    buf += chunk;
    let i = objStart >= 0 ? Math.max(objStart, buf.length - chunk.length) : buf.length - chunk.length;
    for (; i < buf.length; i++) {
      const ch = buf[i];
      if (inString) {
        if (escape) escape = false;
        else if (ch === "\\") escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === "{") {
        if (depth === 0) objStart = i;
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0 && objStart >= 0) {
          onObject(JSON.parse(buf.slice(objStart, i + 1)));
          count++;
          objStart = -1;
        }
      }
    }
    // Trim consumed prefix to keep the buffer small. Keep from the start
    // of any in-flight object; otherwise drop everything scanned.
    if (objStart >= 0) {
      buf = buf.slice(objStart);
      objStart = 0;
    } else {
      buf = "";
    }
  }
  return count;
}

/** Mirror of the API mode's per-class gates, applied to bulk card objects.
 *  Main sets: paper-only, no variation prints (parity with the search
 *  query's game:paper + include_variations=false), then filterPool.
 *  Token sets: everything (art/helper cards aren't paper "game" objects),
 *  then filterTokens. */
function bulkKeep(card, isTokenSet) {
  if (isTokenSet) {
    return (
      !card.digital &&
      (card.layout === "token" || card.layout === "double_faced_token" || card.layout === "emblem")
    );
  }
  if (!Array.isArray(card.games) || !card.games.includes("paper")) return false;
  // Variation prints (same card, alternate printing — DSK Lurking Evil,
  // DMU etched Legends Retold, J25 anime variants) ARE kept: recipes
  // target them via the variation_print filter and the implicit
  // regular_print baseline excludes them from base outcomes.
  return (
    !card.digital &&
    !card.oversized &&
    card.layout !== "token" &&
    card.layout !== "double_faced_token" &&
    card.layout !== "emblem" &&
    card.layout !== "scheme"
  );
}

async function runBulk(codes, tokenCodes) {
  const wanted = new Set(codes);
  console.log(`BULK mode: building ${wanted.size} set pools from Scryfall's all-cards bulk file`);

  // 1. Locate today's all-cards file (one API request — the 10/s class).
  const metaRes = await fetch(`${SCRYFALL}/bulk-data`, {
    headers: { accept: "application/json", "user-agent": "threetreecity-build-set-cards/2.0" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!metaRes.ok) throw new Error(`bulk-data listing failed: ${metaRes.status}`);
  const meta = await metaRes.json();
  const all = meta.data.find((b) => b.type === "all_cards");
  if (!all) throw new Error("no all_cards bulk entry");
  console.log(`all_cards: ${(all.size / 1024 / 1024).toFixed(0)} MB, updated ${all.updated_at}`);

  // 2. Download from the file origin (*.scryfall.io — explicitly no rate
  //    limits per the docs). Streamed straight to disk.
  const tmpFile = join(tmpdir(), "scryfall-all-cards.json");
  console.log(`downloading → ${tmpFile} …`);
  const t0 = Date.now();
  const dl = await fetch(all.download_uri, {
    headers: { "user-agent": "threetreecity-build-set-cards/2.0" },
  });
  if (!dl.ok || !dl.body) throw new Error(`bulk download failed: ${dl.status}`);
  await pipeline(Readable.fromWeb(dl.body), createWriteStream(tmpFile));
  console.log(`downloaded in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  // 3. Stream-parse, bucket, trim.
  const buckets = new Map();
  for (const c of wanted) buckets.set(c, []);
  let scanned = 0;
  const t1 = Date.now();
  await streamJsonArray(tmpFile, (card) => {
    scanned++;
    if (scanned % 200000 === 0) console.log(`  …scanned ${scanned.toLocaleString()} cards`);
    const setCode = (card.set ?? "").toLowerCase();
    if (!wanted.has(setCode)) return;
    const isTokenSet = tokenCodes.has(setCode);
    if (!bulkKeep(card, isTokenSet)) return;
    buckets.get(setCode).push(trimCard(card));
  });
  console.log(`scanned ${scanned.toLocaleString()} cards in ${((Date.now() - t1) / 1000).toFixed(0)}s`);

  // 4. Write per-set gz files, preserving the API mode's sort (set order
  //    comes from Scryfall's bulk ordering, already collector-sorted).
  const stats = { ok: 0, empty: 0, totalCards: 0, totalBytes: 0 };
  for (const [code, cards] of [...buckets.entries()].sort()) {
    if (cards.length === 0) { stats.empty++; continue; }
    const gz = gzipSync(JSON.stringify(cards), { level: 9 });
    await writeFile(join(OUT_DIR, `${code}.json.gz`), gz);
    stats.ok++;
    stats.totalCards += cards.length;
    stats.totalBytes += gz.length;
  }
  await unlink(tmpFile).catch(() => {});
  console.log(`\nDone — ${stats.ok} pools written, ${stats.empty} empty, ${stats.totalCards.toLocaleString()} cards, ${(stats.totalBytes / 1024 / 1024).toFixed(1)} MB gz`);
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
    // Token-set classification for explicit codes: discover only learns
    // t-prefixes from the set-art map, so a not-yet-released set's token
    // sub-set (e.g. `tmsh` passed alongside `msh` before street date)
    // would be misclassified as a main set and the token-only filter
    // inverted — yielding an empty write. Treat an explicit `t<code>`
    // as a token set when its remainder is itself a known main-set code
    // (from the explicit list, the art map, or recipe references).
    // Real sets whose codes merely start with t (tmt, tla, tsp, …) are
    // unaffected: their remainders (mt, la, sp) aren't known set codes.
    const known = new Set([...codes, ...discovered.codes]);
    for (const c of codes) {
      if (c.startsWith("t") && known.has(c.slice(1))) tokenCodes.add(c);
    }
  } else {
    codes = discovered.codes;
    console.log(`Discovered ${codes.length} set codes (openable + tokens + recipe references)`);
    // Full-catalog runs go through the bulk data file — Scryfall's docs
    // require it ("you must use the bulk data files") and it's one
    // unlimited download instead of ~1,200 rate-capped search calls.
    // --missing-only / --resume-after stay on the API path since they
    // touch few codes.
    if (!missingOnly && !resumeAfter) {
      await runBulk(codes, tokenCodes);
      return;
    }
  }

  if (missingOnly) {
    const before = codes.length;
    const filtered = [];
    for (const c of codes) {
      const exists = await fileExists(join(OUT_DIR, `${c}.json.gz`));
      if (!exists) filtered.push(c);
    }
    codes = filtered;
    console.log(`--missing-only: ${codes.length} of ${before} codes need fetching`);
  }

  if (resumeAfter) {
    const before = codes.length;
    codes = codes.filter((c) => c > resumeAfter);
    console.log(`--resume-after ${resumeAfter}: ${codes.length} of ${before} codes remain`);
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
        const raw = await fetchSetCards(code, isTokenSet);
        const filtered = isTokenSet ? filterTokens(raw) : filterPool(raw);
        if (filtered.length === 0) {
          stats.empty++;
          console.log(`${tag} ${code.padEnd(8)} empty — skipping write`);
          return;
        }
        const trimmed = filtered.map(trimCard);
        const json = JSON.stringify(trimmed);
        // Gzip on disk. The JSON is highly compressible (~80% smaller)
        // and Vercel caps serverless function bundles at 250MB unzipped
        // — 371MB of raw JSON blew that. Runtime reads via `gunzipSync`,
        // which costs ~5ms for a 1MB payload, lost in the noise.
        const gz = gzipSync(json, { level: 9 });
        await writeFile(join(OUT_DIR, `${code}.json.gz`), gz);
        stats.ok++;
        stats.totalCards += trimmed.length;
        stats.totalBytes += gz.length;
        const ratio = ((1 - gz.length / json.length) * 100).toFixed(0);
        console.log(`${tag} ${code.padEnd(8)} ${trimmed.length.toString().padStart(4)} cards · ${(gz.length / 1024).toFixed(1).padStart(7)} KB gz (-${ratio}%)`);
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
  console.log(`Total: ${stats.totalCards.toLocaleString()} cards across ${stats.ok} files, ${(stats.totalBytes / 1024 / 1024).toFixed(1)} MB on disk (gzipped)`);
  if (stats.fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Build crashed:", err);
  process.exit(1);
});
