#!/usr/bin/env node
// @ts-check
/**
 * Pre-fetch a representative art-crop URL for every openable Scryfall
 * set and dump the result to `data/set-art.json`. The set-picker pages
 * read this static map at SSR time instead of calling Scryfall live,
 * which avoids:
 *   - Cold-render latency (originally ~20s for the full ~200-set catalog).
 *   - Per-set fetch failures cached by Next.js for 7 days when Scryfall
 *     rate-limits us.
 *   - Hitting Vercel's serverless function timeout on the first request
 *     after a deploy.
 *
 * Usage:
 *   node scripts/build-set-art.mjs                # refresh every set
 *   node scripts/build-set-art.mjs SOS TLA EOE    # refresh specific codes
 *
 * Re-run periodically when new sets land (Scryfall releases a set →
 * we re-run the script → commit the updated JSON). Existing entries
 * are preserved across reruns so a transient Scryfall failure for one
 * new set doesn't blank out everything we already have.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_PATH = join(ROOT, "data", "set-art.json");

const SCRYFALL = "https://api.scryfall.com";
// Scryfall hard-blocks at 10 req/sec. With concurrency=2 each worker
// must keep its own per-request delay ≥ 200ms → combined ≤ 10 req/sec
// for the worker pool itself, plus we add the intra-set fallback sleep.
// We previously had concurrency=6/100ms which 429'd on long runs; this
// trades total wall-clock (~3-4 minutes for ~190 sets) for reliability.
const CONCURRENCY = 2;
const PER_WORKER_THROTTLE_MS = 250;

const UA =
  "ThreeTreeCity-set-art-script/0.1 (https://github.com/honear/mythicpulls fan project)";

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mirrors MIN_CARDS_FOR_PACK in lib/scryfall.ts. Keep in sync — if the
// site filter raises the floor we want this script to follow so we
// don't waste Scryfall calls on sets the picker won't show.
const MIN_CARDS_FOR_PACK = 100;

/** Mirrors lib/scryfall.ts → getOpenableSets but in plain JS. */
async function listOpenableSets() {
  const list = await fetchJson(`${SCRYFALL}/sets`);
  const allowed = new Set([
    "core",
    "expansion",
    "masters",
    "draft_innovation",
    "starter",
    "remastered",
  ]);
  const today = new Date().toISOString().slice(0, 10);
  return list.data
    .filter(
      (s) =>
        !s.digital &&
        s.card_count >= MIN_CARDS_FOR_PACK &&
        allowed.has(s.set_type) &&
        (!s.released_at || s.released_at <= today),
    )
    .sort((a, b) => (b.released_at ?? "").localeCompare(a.released_at ?? ""));
}

/** Mirrors lib/scryfall.ts → getSetSampleArt with the same 3-attempt
 *  fallback chain (priciest → rarity-sorted → unordered). Each request
 *  is followed by a throttle to keep the per-worker rate well under
 *  Scryfall's 10 req/sec ceiling — see CONCURRENCY/PER_WORKER_THROTTLE
 *  comments above. 429 from Scryfall surfaces as a thrown error from
 *  `fetchJson`, which the loop catches and retries the next fallback.
 *
 *  Returns `{ url, artist, cardName }` so we can credit the artist on
 *  every surface that uses an art_crop (homepage CTAs, set tiles,
 *  per-set hero, single-card popups). null on total failure. */
async function sampleArt(code) {
  const set = code.toLowerCase();
  const base = `set:${set} game:paper -is:digital -is:promo -t:token`;
  const attempts = [
    `${SCRYFALL}/cards/search?q=${encodeURIComponent(base)}&unique=cards&order=usd&dir=desc&page=1`,
    `${SCRYFALL}/cards/search?q=${encodeURIComponent(base)}&unique=cards&order=rarity&dir=desc&page=1`,
    `${SCRYFALL}/cards/search?q=${encodeURIComponent(base)}&unique=cards&page=1`,
  ];
  for (const url of attempts) {
    try {
      const page = await fetchJson(url);
      await sleep(PER_WORKER_THROTTLE_MS);
      if (!page) continue;
      for (const c of page.data ?? []) {
        // For double-faced cards, the art lives on `card_faces[0]`,
        // but `artist` is hoisted to the top-level field (it's the
        // same artist for both faces in 99% of MTG history). Pull
        // both from their canonical locations.
        const url =
          c.image_uris?.art_crop ?? c.card_faces?.[0]?.image_uris?.art_crop;
        if (!url) continue;
        const artist =
          c.artist ?? c.card_faces?.[0]?.artist ?? null;
        return {
          url,
          artist,
          cardName: c.name ?? null,
        };
      }
    } catch (err) {
      // Backoff and try next fallback. If we hit a 429, sleep longer so
      // we don't keep hammering through the limit.
      const is429 = String(err?.message ?? "").includes("429");
      await sleep(is429 ? 5000 : PER_WORKER_THROTTLE_MS);
    }
  }
  return null;
}

async function mapWithConcurrency(items, concurrency, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(concurrency, items.length)) },
      worker,
    ),
  );
  return out;
}

async function loadExisting() {
  try {
    const txt = await readFile(OUT_PATH, "utf-8");
    return JSON.parse(txt);
  } catch {
    return { _doc: "", art: {} };
  }
}

async function main() {
  const argCodes = process.argv.slice(2).map((s) => s.toLowerCase());
  const existing = await loadExisting();
  const currentArt = { ...(existing.art ?? {}) };

  process.stdout.write(`Loading openable sets from Scryfall…\n`);
  const sets = await listOpenableSets();
  process.stdout.write(`Found ${sets.length} openable sets.\n`);

  const targets =
    argCodes.length > 0
      ? sets.filter((s) => argCodes.includes(s.code.toLowerCase()))
      : sets;
  process.stdout.write(
    `Fetching art for ${targets.length} set${targets.length === 1 ? "" : "s"} (concurrency=${CONCURRENCY})…\n`,
  );

  let resolved = 0;
  let skipped = 0;
  const results = await mapWithConcurrency(
    targets,
    CONCURRENCY,
    async (s) => {
      const code = s.code.toLowerCase();
      const art = await sampleArt(code);
      if (art) {
        resolved += 1;
        const tag = art.artist ? ` (by ${art.artist})` : "";
        process.stdout.write(`  ✓ ${code.padEnd(6)} ${s.name}${tag}\n`);
      } else {
        skipped += 1;
        process.stdout.write(
          `  – ${code.padEnd(6)} ${s.name} (no art_crop available)\n`,
        );
      }
      return [code, art];
    },
  );

  // Migrate any legacy string-shaped entries from a previous build to
  // the new `{ url, artist, cardName }` object shape. We don't know
  // the artist for legacy strings (this run only refreshes the codes
  // we just fetched), but at least the shape stays uniform.
  for (const code of Object.keys(currentArt)) {
    const v = currentArt[code];
    if (typeof v === "string") {
      currentArt[code] = { url: v, artist: null, cardName: null };
    }
  }

  for (const [code, art] of results) {
    if (art) currentArt[code] = art;
    // Don't wipe existing entries on null — Scryfall failing for one set
    // shouldn't blank out a previously-resolved URL.
  }

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(
    OUT_PATH,
    JSON.stringify(
      {
        _doc:
          "Per-set art_crop URLs + artist credits used as backgrounds + footer credits across the site. Generated by `node scripts/build-set-art.mjs`. Each entry is `{ url, artist, cardName }`. Pages read this static map at SSR time — no live Scryfall calls. Re-run when new sets are added.",
        generatedAt: new Date().toISOString(),
        setCount: Object.keys(currentArt).length,
        art: currentArt,
      },
      null,
      2,
    ),
    "utf-8",
  );
  process.stdout.write(
    `\nWrote ${OUT_PATH} — ${Object.keys(currentArt).length} sets cached (${resolved} fetched this run, ${skipped} with no art).\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
