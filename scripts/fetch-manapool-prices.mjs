#!/usr/bin/env node
// @ts-check
/**
 * Fetch sealed-product prices from the public Mana Pool API and write a
 * trimmed static map to `data/manapool-prices.json`. The site reads this
 * file via `lib/manapool.ts` to show live marketplace prices in the
 * MoneyStrip and to deep-link the "Buy on ManaPool" buttons.
 *
 * Usage:
 *   node scripts/fetch-manapool-prices.mjs
 *
 * The endpoint (https://manapool.com/api/v1/prices/sealed) is public,
 * no auth required. It returns ~1700 in-stock sealed products with
 * fields: product_type, product_id, set_code, name, tcgplayer_product_id,
 * language_id, low_price (cents), available_quantity, price_market (cents),
 * url. We index by lowercase set code → pack-type slug, keeping only the
 * fields the UI needs.
 *
 * The static-data pattern (matching scripts/build-set-art.mjs and
 * scripts/fetch-17lands.mjs) means cold renders never hit the ManaPool
 * API. Run this script weekly (or on demand) to refresh prices.
 *
 * Following the convention from AGENTS.md — third-party APIs we depend
 * on get pre-fetched into JSON in `data/` rather than called at SSR.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_PATH = join(ROOT, "data", "manapool-prices.json");

const ENDPOINT = "https://manapool.com/api/v1/prices/sealed";
const USER_AGENT = "ThreeTreeCity-manapool-prices/0.1 (+https://github.com/honear)";

/**
 * Map a ManaPool product URL slug to our internal pack-type key.
 * Returns null for slugs we don't surface (booster boxes, bundles,
 * prerelease packs, etc.) — the simulator only opens individual packs.
 *
 *   `play-booster-pack`      → "play"        (modern: 2024-02+)
 *   `draft-booster-pack`     → "draft"       (modern legacy)
 *   `collector-booster-pack` → "collector"
 *   `set-booster-pack`       → "set"         (legacy 2020–2023; we don't
 *                                              currently open these but
 *                                              keep them for completeness)
 *   `booster-pack` (no type) → "booster"     (pre-modern: one pack type)
 *
 * @param {string} slug
 * @returns {"play" | "draft" | "collector" | "set" | "booster" | null}
 */
function classify(slug) {
  if (slug === "play-booster-pack") return "play";
  if (slug === "draft-booster-pack") return "draft";
  if (slug === "collector-booster-pack") return "collector";
  if (slug === "set-booster-pack") return "set";
  if (slug === "booster-pack") return "booster";
  return null;
}

/**
 * @param {string} url
 * @returns {string | null} the last path segment, or null if missing.
 */
function lastSegment(url) {
  if (!url) return null;
  const trimmed = url.replace(/\/$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx < 0) return null;
  return trimmed.slice(idx + 1);
}

async function main() {
  console.log(`Fetching ${ENDPOINT}…`);
  const res = await fetch(ENDPOINT, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`ManaPool API returned ${res.status} ${res.statusText}`);
  }
  /** @type {{ meta: { as_of: string }, data: Array<{
   *    product_type: string,
   *    product_id: string,
   *    set_code: string,
   *    name: string,
   *    tcgplayer_product_id: number | null,
   *    language_id: string,
   *    low_price: number,
   *    available_quantity: number,
   *    price_market: number | null,
   *    url: string,
   *  }> }} */
  const body = await res.json();

  const listings = body.data ?? [];
  console.log(`  ${listings.length} listings (as_of ${body.meta?.as_of})`);

  /** @type {Record<string, Record<string, {
   *   lowCents: number,
   *   marketCents: number | null,
   *   available: number,
   *   name: string,
   *   url: string,
   * }>>} */
  const sets = {};

  let kept = 0;
  let skippedNonEn = 0;
  let skippedNonPack = 0;

  for (const entry of listings) {
    // English only — keeps the file small and avoids surfacing a Japanese
    // pack listing when the user just wants the standard English MSRP.
    if (entry.language_id !== "EN") {
      skippedNonEn++;
      continue;
    }
    const slug = lastSegment(entry.url);
    const packKey = slug ? classify(slug) : null;
    if (!packKey) {
      skippedNonPack++;
      continue;
    }
    const setCode = entry.set_code.toLowerCase();
    if (!sets[setCode]) sets[setCode] = {};
    // If we already have a listing for this (set, packKey) — which would
    // be unusual since the endpoint dedupes by product — keep the cheaper
    // floor. Defensive against future product splits.
    const existing = sets[setCode][packKey];
    if (existing && existing.lowCents <= entry.low_price) continue;
    sets[setCode][packKey] = {
      lowCents: entry.low_price,
      marketCents: entry.price_market ?? null,
      available: entry.available_quantity,
      name: entry.name,
      url: entry.url,
    };
    kept++;
  }

  const indexedSets = Object.keys(sets).length;
  console.log(
    `  kept ${kept} (${indexedSets} sets); skipped ${skippedNonEn} non-EN, ${skippedNonPack} non-pack products`,
  );

  const out = {
    meta: {
      as_of: body.meta?.as_of ?? new Date().toISOString(),
      fetched_at: new Date().toISOString(),
      source: ENDPOINT,
      total_listings: listings.length,
      indexed_sets: indexedSets,
      indexed_packs: kept,
    },
    sets,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf-8");
  console.log(`Wrote ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
