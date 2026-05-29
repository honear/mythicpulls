/**
 * Thin compatibility layer over the new data-driven booster config.
 *
 * Historically PACKS held the entire slot recipe in TypeScript. After the
 * refactor it's loaded from data/booster-contents/default.json at module
 * load and exposed in the legacy shape so existing imports (PACKS,
 * getPackCost, recommendedPackType, packsAvailableFor) keep working.
 *
 * Per-set recipe overrides live at `data/booster-contents/<setCode>.json`
 * — the file is auto-discovered by lowercase set code. Define only the
 * pack types that diverge from the default; missing pack types fall
 * through to `data/booster-contents/default.json`. There is no longer
 * a `data/sets/` indirection layer.
 *
 * Pack prices are sourced exclusively from Mana Pool live market data
 * (lib/manapool.ts → data/manapool-prices.json). There is no hand-set
 * MSRP fallback anywhere; if Mana Pool doesn't carry a product,
 * `getPackCost` returns null and the UI shows "Not available".
 */

import type { ScryfallSet } from "./scryfall";
import type { PackType } from "./booster-config";
// Hot path: synchronously bundle the default content so PACKS can be a
// plain object available at module evaluation time. Per-set recipes are
// still loaded asynchronously via resolveRecipe in the route layer.
import defaultContentJson from "../data/booster-contents/default.json";
// Live marketplace prices from Mana Pool, refreshed by
// `scripts/fetch-manapool-prices.mjs`. This is the SOLE source of pack
// prices in the app — see lib/manapool.ts for the static-data shape.
import { getManaPoolSpendPrice } from "./manapool";

export type { PackType } from "./booster-config";

interface DefaultContentShape {
  /** Universal MSRP fallback per pack type. Consulted by `getPackCost`
   *  when Mana Pool doesn't carry the (set, packType). Edit
   *  `data/booster-contents/default.json::costUsd` to retune. */
  costUsd?: Partial<Record<PackType, number>>;
  play?: { cardCount: number; tagline?: string };
  draft?: { cardCount: number; tagline?: string };
  collector?: { cardCount: number; tagline?: string };
  jumpstart?: { cardCount: number; tagline?: string };
}

const defaultContent = defaultContentJson as unknown as DefaultContentShape;

/** Legacy-shape pack metadata exposed for UI affordances (pack name,
 *  tagline, card count, fallback MSRP). Slot recipes are loaded
 *  asynchronously via resolveRecipe and are NOT exposed here. */
export interface PackDefinition {
  type: PackType;
  name: string;
  tagline: string;
  cardCount: number;
  /** Fallback MSRP from `data/booster-contents/default.json::costUsd`.
   *  This is the bottom of the price chain — used when neither Mana
   *  Pool nor a set-specific `costUsd` has a value. */
  costUsd: number;
}

function buildDefinition(t: PackType, displayName: string): PackDefinition {
  const block = defaultContent[t];
  return {
    type: t,
    name: displayName,
    tagline: block?.tagline ?? "",
    cardCount: block?.cardCount ?? 15,
    costUsd: defaultContent.costUsd?.[t] ?? 0,
  };
}

export const PACKS: Record<PackType, PackDefinition> = {
  play: buildDefinition("play", "Play Booster"),
  draft: buildDefinition("draft", "Draft Booster"),
  collector: buildDefinition("collector", "Collector Booster"),
  jumpstart: buildDefinition("jumpstart", "Jumpstart Booster"),
};

export const PACK_ORDER: PackType[] = ["play", "draft", "collector", "jumpstart"];

/**
 * Pack price for the client's sync path (MoneyStrip math). Resolution:
 *
 *   1. Mana Pool live market price for (setCode, packType).
 *   2. `data/booster-contents/default.json::costUsd[packType]` —
 *      bundled at module load; lets the MoneyStrip's "Spent" counter
 *      still tally a reasonable number for sets Mana Pool doesn't
 *      currently stock.
 *   3. null — UI renders "Not available".
 *
 * Per-set `costUsd` overrides from
 * `data/booster-contents/<setCode>.json` are NOT consulted here because
 * we can't statically bundle every per-set file; the async
 * `resolveRecipe` server path handles that and the resolved value
 * arrives via the `costs` prop on PackOpener. The sync path is a fallback
 * for any pack type the route didn't pre-resolve.
 */
export function getPackCost(
  packType: PackType,
  setCode?: string,
): number | null {
  if (setCode) {
    const live = getManaPoolSpendPrice(setCode, packType);
    if (typeof live === "number") return live;
  }
  const fallback = defaultContent.costUsd?.[packType];
  return typeof fallback === "number" ? fallback : null;
}

/** Recommend a default pack type based on release date. */
export function recommendedPackType(set: ScryfallSet): PackType {
  const released = set.released_at ?? "";
  if (released >= "2024-02-01") return "play";
  return "draft";
}

/**
 * Sync legacy heuristic. The new code path is `packsAvailableForSet` in
 * lib/booster-config.ts which can read per-set overrides; this stays as
 * a fallback for any callers that haven't been updated yet.
 */
export function packsAvailableFor(set: ScryfallSet): PackType[] {
  const released = set.released_at ?? "";
  const types: PackType[] = [];
  if (released >= "2024-02-01") types.push("play");
  types.push("draft");
  if (released >= "2019-10-01") types.push("collector");
  return types;
}
