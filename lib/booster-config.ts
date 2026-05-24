/**
 * Booster config types + pure helpers — safe to import from client code.
 *
 * The actual fs-based loaders live in lib/booster-loader.ts and must only
 * be imported from server components / route handlers. Splitting them
 * keeps the Next.js client bundle free of the Node `fs` and `path` modules.
 */

export type PackType = "play" | "draft" | "collector";
export type Rarity = "common" | "uncommon" | "rare" | "mythic";

/**
 * A single weighted outcome for a slot. The slot picks one of its outcomes
 * proportional to `weight`, then draws a card from the pool that matches
 * the outcome's (set × rarity × filter) constraints.
 *
 *  - `set` omitted ⇒ pool is the pack's own set.
 *  - `set: "$tokens"` ⇒ pool is whatever Scryfall returns for `t<setCode>`
 *    (the conventional tokens-set companion). Lets recipes stay generic.
 *  - `rarity` omitted ⇒ no rarity constraint (filter alone narrows the pool).
 *  - `filter` references a named predicate in data/filters.json.
 *  - `foil: true` forces this outcome foil even if the slot is non-foil.
 */
export interface Outcome {
  weight: number;
  set?: string;
  rarity?: Rarity;
  filter?: string;
  foil?: boolean;
  label?: string;
}

export interface SlotRecipe {
  label: string;
  /** How many cards this slot contributes. Default 1. */
  count?: number;
  foil?: boolean;
  basicLand?: boolean;
  token?: boolean;
  outcomes: Outcome[];
}

export interface PackContent {
  cardCount: number;
  /** Hand-typed tagline shown in pack selectors. Optional. */
  tagline?: string;
  slots: SlotRecipe[];
}

export interface BoosterContents {
  play?: PackContent;
  draft?: PackContent;
  collector?: PackContent;
  /** Hand-set MSRP per pack type, used as a fallback when Mana Pool
   *  doesn't carry the product. Resolution: Mana Pool live → set-
   *  specific costUsd → default costUsd → undefined ("Not available").
   *  Edit the relevant `data/booster-contents/*.json` to tweak these. */
  costUsd?: Partial<Record<PackType, number>>;
}

/** Translates the `$tokens` sentinel to a real set code. Pure helper —
 *  safe everywhere. */
export function resolveSetSentinel(
  raw: string | undefined,
  ownSetCode: string,
): string | undefined {
  if (!raw) return undefined;
  if (raw === "$tokens") return `t${ownSetCode.toLowerCase()}`;
  return raw.toLowerCase();
}

/**
 * Walk a content's slot outcomes and collect every Scryfall set code it
 * references. Used by the route layer so we can pre-fetch all subset card
 * pools (e.g. SOA, PSOS, TSOS for SOS) in parallel before rendering. Pure.
 */
export function collectReferencedSets(
  content: PackContent,
  ownSetCode: string,
): string[] {
  const own = ownSetCode.toLowerCase();
  const seen = new Set<string>([own]);
  for (const slot of content.slots) {
    for (const o of slot.outcomes) {
      const target = resolveSetSentinel(o.set, own);
      if (target) seen.add(target.toLowerCase());
    }
  }
  return Array.from(seen);
}
