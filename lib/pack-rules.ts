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

export type { PackType } from "./booster-config";

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
 * MSRP lookup. Priority: per-set override (data/sets/<code>.json cost.<type>)
 * > default content's costUsd.<type> > PackDefinition.costUsd.
 *
 * Sync version that consults a small bundled map of well-known overrides for
 * sets we want priced correctly without a per-set JSON file. New per-set
 * overrides should be added by creating data/sets/<code>.json + cost block.
 */
export function getPackCost(packType: PackType, setCode?: string): number {
  if (setCode) {
    const code = setCode.toLowerCase();
    const override = LEGACY_MSRP_OVERRIDES[code]?.[packType];
    if (typeof override === "number") return override;
  }
  return PACKS[packType].costUsd;
}

/**
 * Sync per-set MSRP overrides retained for compatibility with the
 * synchronous PackOpener path. The async path lives at the route layer:
 * it calls resolveRecipe (lib/booster-loader.ts) which reads
 * data/sets/<code>.json + data/booster-contents/* and passes the resolved
 * cost down to PackOpener as a prop. New overrides should land as
 * data/sets/<code>.json instead.
 */
const LEGACY_MSRP_OVERRIDES: Record<string, Partial<Record<PackType, number>>> = {
  ltr: { collector: 34.99 },
  fin: { collector: 34.99 },
  ltc: { collector: 34.99 },
  fdn: { collector: 39.99 },
  dsk: { collector: 24.99 },
  blb: { collector: 24.99 },
  otj: { collector: 27.99 },
  mh3: { collector: 31.99 },
  lci: { collector: 23.99 },
  woe: { collector: 23.99 },
  sos: { collector: 34.99 },
};

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
