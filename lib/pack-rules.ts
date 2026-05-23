/**
 * Thin compatibility layer over the new data-driven booster config.
 *
 * Historically PACKS held the entire slot recipe in TypeScript. After the
 * refactor it's loaded from data/booster-contents/default.json at module
 * load and exposed in the legacy shape so existing imports (PACKS,
 * getPackCost, recommendedPackType, packsAvailableFor) keep working.
 *
 * Per-set tweaks now live in:
 *   - data/sets/<code>.json — pointer + MSRP overrides per pack type
 *   - data/booster-contents/<name>.json — actual slot recipes
 * Look at lib/booster-config.ts for the loader API used by route code.
 */

import type { ScryfallSet } from "./scryfall";
import type { PackType } from "./booster-config";
// Hot path: synchronously bundle the default content so PACKS can be a
// plain object available at module evaluation time. Per-set recipes are
// still loaded asynchronously via resolveRecipe in the route layer.
import defaultContentJson from "../data/booster-contents/default.json";
// Per-set MSRP map. Single user-editable file at data/booster-prices.json.
// Bundled here so the sync code path (PackOpener's MoneyStrip math) can
// read it without going through node:fs.
import boosterPricesJson from "../data/booster-prices.json";

export type { PackType } from "./booster-config";

/**
 * User-editable per-set price overrides. Keys are lowercase Scryfall set
 * codes (plus a "default" entry as a baseline). The `getPackCost` lookup
 * consults this map FIRST, before falling back to bundled defaults.
 *
 * Edit data/booster-prices.json to tweak prices without touching any TS.
 */
const BOOSTER_PRICES = boosterPricesJson as unknown as Record<
  string,
  Partial<Record<PackType, number>>
>;

interface DefaultContentShape {
  costUsd?: Partial<Record<PackType, number>>;
  play?: { cardCount: number; tagline?: string };
  draft?: { cardCount: number; tagline?: string };
  collector?: { cardCount: number; tagline?: string };
}

const defaultContent = defaultContentJson as unknown as DefaultContentShape;

/** Legacy-shape pack metadata exposed for UI affordances (pack name,
 *  tagline, default MSRP). Slot recipes themselves are loaded
 *  asynchronously via resolveRecipe and are NOT exposed here. */
export interface PackDefinition {
  type: PackType;
  name: string;
  tagline: string;
  cardCount: number;
  /** Default USD MSRP — overridable per-set via data/sets/<code>.json. */
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
};

export const PACK_ORDER: PackType[] = ["play", "draft", "collector"];

/**
 * MSRP lookup. Resolution order:
 *   1. data/booster-prices.json — per-set entry for this packType
 *   2. data/booster-prices.json — "default" entry for this packType
 *   3. data/booster-contents/default.json — bundled fallback
 *
 * Edit data/booster-prices.json to tweak any price; no code changes needed.
 */
export function getPackCost(packType: PackType, setCode?: string): number {
  if (setCode) {
    const override = BOOSTER_PRICES[setCode.toLowerCase()]?.[packType];
    if (typeof override === "number") return override;
  }
  const baseline = BOOSTER_PRICES.default?.[packType];
  if (typeof baseline === "number") return baseline;
  return PACKS[packType].costUsd;
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
