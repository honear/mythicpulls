#!/usr/bin/env node
// @ts-check
/**
 * Post-deploy cache warmer. Pings every set's three render routes so the
 * Next.js edge cache + the downstream Scryfall fetches are populated
 * before the first real user shows up.
 *
 * Without this, the very first visitor to a given set after a deploy
 * pays the cold-fetch cost — `/draft/[code]` for a large set can take
 * 20-30s while the server paginates Scryfall for the main pool +
 * referenced sub-sets + tokens. With this, that cold cost is paid by
 * us once, and every subsequent visitor (for the next ~24h, the
 * default `next: { revalidate: 86400 }` window in lib/scryfall.ts)
 * gets a sub-200ms response.
 *
 * Usage:
 *   # Warm the live deploy (default base URL is the prod domain)
 *   node scripts/warm-cache.mjs
 *
 *   # Warm a preview / local
 *   BASE_URL=https://three-tree-city-pr-42.vercel.app node scripts/warm-cache.mjs
 *   BASE_URL=http://localhost:3000 node scripts/warm-cache.mjs
 *
 *   # Warm a subset only
 *   node scripts/warm-cache.mjs sos blb mh3
 *
 * Wire into a Vercel "Deploy Succeeded" webhook (or a GitHub Action
 * triggered by vercel.deploy:* events) so this runs automatically after
 * each prod deploy.
 *
 * The set list comes from data/set-art.json — its keys ARE the
 * openable-set codes (build-set-art.mjs filters to the same
 * MIN_CARDS_FOR_PACK threshold the runtime uses). That keeps the warmer
 * list aligned with the runtime list without re-implementing the filter.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SET_ART_PATH = join(ROOT, "data", "set-art.json");

const BASE_URL = (process.env.BASE_URL ?? "https://threetreecity.vercel.app").replace(/\/+$/, "");
// Warmer hits OUR server, which then triggers Scryfall fetches with the
// throttling already baked into lib/scryfall.ts. Bumping warmer-side
// concurrency past ~6 doesn't make Scryfall any happier (the server
// queues), and it does flood Vercel's serverless layer. 4 is the sweet
// spot — three routes × ~175 sets × ~5s avg cold render = ~37 minutes
// at concurrency=4. Acceptable for a once-per-deploy run.
const CONCURRENCY = 4;
const ROUTES = ["/sets", "/draft", "/sealed"];

const codes = process.argv.slice(2);

/** Resolve the set list — CLI args win; otherwise read the keys of
 *  data/set-art.json. We deliberately don't hit Scryfall to discover
 *  sets because (a) the warmer should be runnable in CI without the
 *  10 req/sec budget, and (b) set-art.json is the canonical list of
 *  sets the site offers at runtime. */
async function loadSetCodes() {
  if (codes.length) return codes.map((c) => c.toLowerCase());
  const raw = await readFile(SET_ART_PATH, "utf8");
  const map = JSON.parse(raw);
  return Object.keys(map).map((c) => c.toLowerCase());
}

/** Build the full list of `${BASE}${route}/${code}` URLs to warm. */
function buildTargets(setCodes) {
  const out = [];
  for (const code of setCodes) {
    for (const route of ROUTES) {
      out.push(`${BASE_URL}${route}/${code}`);
    }
  }
  return out;
}

/** Fetch one URL — we only need the response headers + a small head
 *  of the body for the page to actually render server-side (Next won't
 *  start the RSC stream until something asks for it). Using GET (not
 *  HEAD) ensures the server fully renders + caches; HEAD is short-
 *  circuited by some middleware and might skip the work we want. */
async function warmOne(url) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      // Disable Next's bypass cookie / draft-mode behavior we might
      // accidentally pick up from a real browser session. None should
      // apply here, but explicit > implicit.
      headers: { "user-agent": "threetreecity-cache-warmer/1.0" },
      redirect: "follow",
    });
    // Drain the body so the server actually finishes rendering — fetch
    // doesn't always complete the response until we consume it.
    await res.text();
    const ms = Date.now() - started;
    const tag = res.ok ? "OK " : `${res.status}`;
    console.log(`${tag} ${ms.toString().padStart(5)}ms  ${url}`);
    return res.ok;
  } catch (err) {
    const ms = Date.now() - started;
    console.error(`ERR ${ms.toString().padStart(5)}ms  ${url}  ${err.message ?? err}`);
    return false;
  }
}

/** Bounded-concurrency runner. Mirrors the pattern in lib/concurrency.ts
 *  but inlined so the warmer has no app-side deps and can run in any
 *  Node environment (CI runners, deploy hooks, etc.). */
async function runPool(items, worker, concurrency) {
  let cursor = 0;
  let ok = 0;
  let fail = 0;
  const inFlight = new Array(concurrency).fill(null).map(async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      const success = await worker(items[idx]);
      if (success) ok++; else fail++;
    }
  });
  await Promise.all(inFlight);
  return { ok, fail };
}

async function main() {
  const setCodes = await loadSetCodes();
  const targets = buildTargets(setCodes);
  console.log(`Warming ${targets.length} URLs (${setCodes.length} sets × ${ROUTES.length} routes)`);
  console.log(`Base:        ${BASE_URL}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log("");

  const t0 = Date.now();
  const { ok, fail } = await runPool(targets, warmOne, CONCURRENCY);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  console.log("");
  console.log(`Done in ${secs}s — ${ok} ok, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Warmer crashed:", err);
  process.exit(1);
});
