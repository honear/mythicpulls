/**
 * Mana Pool integration — live sealed-product prices + deep links.
 *
 * Static-data pattern (see AGENTS.md): the actual price snapshot lives in
 * `data/manapool-prices.json`, produced by `scripts/fetch-manapool-prices.mjs`
 * which hits the public Mana Pool API (`/api/v1/prices/sealed`). The file
 * is small (~50 KB) so it imports cleanly into both server and client
 * bundles, replacing the previous hard-coded MSRP map for any set Mana
 * Pool currently has stock for.
 *
 * Resolution rules (see `lib/pack-rules.ts::getPackCost` and
 * `lib/booster-loader.ts::resolveRecipe`):
 *   1. Mana Pool market price for this (set, packType) — most honest
 *      "what you'd actually pay" figure.
 *   2. Mana Pool low ask — used when there's no recent-sales market price.
 *   3. null — surfaces as "Not available" in the UI. There is no
 *      hand-set MSRP fallback anywhere; Mana Pool is the only source.
 *
 * Buy links go to the canonical product page at
 * `https://manapool.com/sealed/<set>/<slug>` (or `/card/<set>/<num>` for
 * singles, which 301-redirects to the canonical slug). When the user has
 * an affiliate code configured via `NEXT_PUBLIC_MANAPOOL_REF`, it's
 * appended as `?ref=`. The env var is optional; if unset, links go out
 * un-tagged. (See https://manapool.com/affiliates.)
 */

import data from "../data/manapool-prices.json";
import type { PackType } from "./booster-config";

/** Affiliate code appended to all Mana Pool deep links when set.
 *  Configure via `NEXT_PUBLIC_MANAPOOL_REF` in `.env.local`. Reading from
 *  process.env directly (vs a config module) keeps this file dependency-
 *  free for both server and client builds. */
export const MANAPOOL_REF = process.env.NEXT_PUBLIC_MANAPOOL_REF ?? "";

/** Append `?ref=<MANAPOOL_REF>` to a URL when the affiliate handle is set,
 *  otherwise return the URL unchanged. Handles the case where the URL
 *  already has a query string. */
export function withManaPoolRef(url: string): string {
  if (!MANAPOOL_REF) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}ref=${encodeURIComponent(MANAPOOL_REF)}`;
}

/** One in-stock sealed-product listing on Mana Pool. */
export interface ManaPoolListing {
  /** Marketplace floor (lowest current ask) in USD. */
  lowUsd: number;
  /** Volume-weighted/recent-sales market price in USD, or null when the
   *  product has no recent sales. Prefer this over `lowUsd` for display
   *  since the floor can be a single outlier listing. */
  marketUsd: number | null;
  /** Units currently in stock across all sellers. */
  available: number;
  /** Full product display name from Mana Pool. */
  name: string;
  /** Canonical product URL (without ref). */
  url: string;
}

interface RawListing {
  lowCents: number;
  marketCents: number | null;
  available: number;
  name: string;
  url: string;
}

interface ManaPoolFile {
  meta: { as_of: string; fetched_at: string; source: string };
  sets: Record<string, Partial<Record<string, RawListing>>>;
}

const FILE = data as unknown as ManaPoolFile;

/** Timestamp of the underlying price snapshot — surfaced in the UI to
 *  let users see how fresh the numbers are. */
export const MANAPOOL_AS_OF: string = FILE.meta.as_of;

function toListing(raw: RawListing | undefined): ManaPoolListing | null {
  if (!raw) return null;
  return {
    lowUsd: raw.lowCents / 100,
    marketUsd: raw.marketCents != null ? raw.marketCents / 100 : null,
    available: raw.available,
    name: raw.name,
    url: raw.url,
  };
}

/**
 * Look up a sealed booster listing for (setCode, packType). Returns null
 * when Mana Pool doesn't have current stock, in which case the caller
 * should fall back to its MSRP map.
 *
 * Pre-modern sets only have a generic "Booster Pack" product (no Play /
 * Draft / Collector distinction) — they're indexed under the "booster"
 * key. We fall back to that when the requested type isn't listed; older
 * sets in our config are typed as `"draft"` so this preserves the link.
 */
export function getManaPoolPackListing(
  setCode: string,
  packType: PackType,
): ManaPoolListing | null {
  const set = FILE.sets[setCode.toLowerCase()];
  if (!set) return null;
  const direct = toListing(set[packType]);
  if (direct) return direct;
  // Legacy single-type sets (e.g., 10E, M-series) — fall back to the
  // generic "booster-pack" listing, applicable when our config uses
  // "draft" for the only available type on the set.
  if (packType === "draft") return toListing(set["booster"]);
  return null;
}

/**
 * Live spend price for the MoneyStrip's "Spent" tally and the rip button
 * label. Returns Mana Pool's market price when available (a more honest
 * representation than the floor, which can be an outlier listing), then
 * the low ask, then null so the caller can fall back to MSRP.
 */
export function getManaPoolSpendPrice(
  setCode: string,
  packType: PackType,
): number | null {
  const listing = getManaPoolPackListing(setCode, packType);
  if (!listing) return null;
  return listing.marketUsd ?? listing.lowUsd;
}

/**
 * Deep link to the sealed-product page for (setCode, packType), with
 * the affiliate ref appended when configured. Returns null if Mana Pool
 * doesn't carry the product so callers can hide the button entirely.
 */
export function getManaPoolPackUrl(
  setCode: string,
  packType: PackType,
): string | null {
  const listing = getManaPoolPackListing(setCode, packType);
  if (!listing) return null;
  return withManaPoolRef(listing.url);
}

/**
 * Deep link to a single card's Mana Pool product page. Built from the
 * Scryfall set code + collector number — Mana Pool's `/card/<set>/<num>`
 * URL 301-redirects to the canonical slug, so we don't need to slugify
 * the card name client-side or hit their API per card. Works for every
 * card we display, in stock or not.
 */
export function getManaPoolCardUrl(card: {
  set: string;
  collector_number: string;
}): string {
  // Encode the collector number — split cards / promo numbers like "4★"
  // and "265a" need encoding; standard digits pass through unchanged.
  const url = `https://manapool.com/card/${encodeURIComponent(
    card.set.toLowerCase(),
  )}/${encodeURIComponent(card.collector_number)}`;
  return withManaPoolRef(url);
}
