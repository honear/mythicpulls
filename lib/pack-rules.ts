import type { ScryfallSet } from "./scryfall";

export type PackType = "play" | "draft" | "collector";

export interface SlotRule {
  /** Display label for the slot — used in pull breakdown UI. */
  label: string;
  /** Rarity weights for this slot. Numbers are relative weights. */
  weights: Partial<Record<"common" | "uncommon" | "rare" | "mythic", number>>;
  /** Whether this card should be visually treated as foil. */
  foil?: boolean;
  /**
   * Optional constraint: prefer basic lands for this slot. If the set has no
   * basic lands, fallback is a common.
   */
  basicLand?: boolean;
  /** When true, pull from the set's token pool instead of normal rarities. */
  token?: boolean;
}

export interface PackDefinition {
  type: PackType;
  name: string;
  tagline: string;
  cardCount: number;
  /** Slot list applied top to bottom; one card per slot. */
  slots: SlotRule[];
  /** Approximate USD MSRP — used to compute pulled-vs-spent stats. */
  costUsd: number;
}

/**
 * Mythic ratio in the rare slot of modern boosters is ~1 in 7.4
 * (≈13.5% mythic / 86.5% rare). Encoded as integer weights.
 */
const RARE_MYTHIC = { rare: 86, mythic: 14 } as const;

/**
 * Wildcard slot in Play Boosters is roughly:
 *  ~70% common, ~20% uncommon, ~8% rare, ~2% mythic.
 */
const WILDCARD = { common: 70, uncommon: 20, rare: 8, mythic: 2 } as const;

/** Foil slot rarity distribution — roughly 67/20/10/3 c/u/r/m. */
const FOIL_WILDCARD = { common: 67, uncommon: 20, rare: 10, mythic: 3 } as const;

/** Token slot — first card in every pack. Weights are irrelevant since
 *  the pull source is the dedicated token pool. */
const TOKEN_SLOT: SlotRule = {
  label: "Token",
  weights: { common: 1 },
  token: true,
};

export const PACKS: Record<PackType, PackDefinition> = {
  play: {
    type: "play",
    name: "Play Booster",
    tagline: "14 cards + token · 1 rare/mythic · 1 traditional foil · modern standard",
    cardCount: 15,
    costUsd: 5.99,
    slots: [
      TOKEN_SLOT,
      { label: "Common", weights: { common: 1 } },
      { label: "Common", weights: { common: 1 } },
      { label: "Common", weights: { common: 1 } },
      { label: "Common", weights: { common: 1 } },
      { label: "Common", weights: { common: 1 } },
      { label: "Common", weights: { common: 1 } },
      { label: "Uncommon", weights: { uncommon: 1 } },
      { label: "Uncommon", weights: { uncommon: 1 } },
      { label: "Uncommon", weights: { uncommon: 1 } },
      { label: "Wildcard", weights: { ...WILDCARD } },
      { label: "Rare / Mythic", weights: { ...RARE_MYTHIC } },
      { label: "Land", weights: { common: 1 }, basicLand: true },
      { label: "Foil", weights: { ...FOIL_WILDCARD }, foil: true },
      { label: "Bonus", weights: { rare: 80, mythic: 20 } },
    ],
  },
  draft: {
    type: "draft",
    name: "Draft Booster",
    tagline: "15 cards + token · 1 rare/mythic · 1 basic land · the classic format",
    cardCount: 16,
    costUsd: 3.99,
    slots: [
      TOKEN_SLOT,
      ...Array.from({ length: 10 }, () => ({
        label: "Common" as const,
        weights: { common: 1 },
      })),
      { label: "Uncommon", weights: { uncommon: 1 } },
      { label: "Uncommon", weights: { uncommon: 1 } },
      { label: "Uncommon", weights: { uncommon: 1 } },
      { label: "Rare / Mythic", weights: { ...RARE_MYTHIC } },
      { label: "Land", weights: { common: 1 }, basicLand: true },
    ],
  },
  collector: {
    type: "collector",
    name: "Collector Booster",
    tagline: "15 premium cards + token · all foil/showcase · the chase pack",
    cardCount: 16,
    costUsd: 25.99,
    slots: [
      TOKEN_SLOT,
      { label: "Foil Common", weights: { common: 1 }, foil: true },
      { label: "Foil Common", weights: { common: 1 }, foil: true },
      { label: "Foil Common", weights: { common: 1 }, foil: true },
      { label: "Foil Common", weights: { common: 1 }, foil: true },
      { label: "Foil Common", weights: { common: 1 }, foil: true },
      { label: "Foil Uncommon", weights: { uncommon: 1 }, foil: true },
      { label: "Foil Uncommon", weights: { uncommon: 1 }, foil: true },
      { label: "Foil Uncommon", weights: { uncommon: 1 }, foil: true },
      { label: "Foil Uncommon", weights: { uncommon: 1 }, foil: true },
      { label: "Showcase Rare", weights: { rare: 90, mythic: 10 }, foil: true },
      { label: "Showcase Rare", weights: { rare: 80, mythic: 20 }, foil: true },
      { label: "Foil Rare", weights: { rare: 80, mythic: 20 }, foil: true },
      { label: "Foil Rare", weights: { rare: 70, mythic: 30 }, foil: true },
      { label: "Foil Land", weights: { common: 1 }, basicLand: true, foil: true },
      { label: "Foil Rare / Mythic", weights: { rare: 60, mythic: 40 }, foil: true },
    ],
  },
};

export const PACK_ORDER: PackType[] = ["play", "draft", "collector"];

/**
 * Recommend a pack type based on the set's release date.
 * Play Booster format rolled out fully in 2024-02 (MKM onward).
 */
export function recommendedPackType(set: ScryfallSet): PackType {
  const released = set.released_at ?? "";
  if (released >= "2024-02-01") return "play";
  return "draft";
}

/**
 * Which pack types we surface for a given set. We're generous: we let users
 * try any pack type on any set, but mark a default. This is a fan project, not
 * a perfect simulation of Wizards' SKU history.
 */
export function packsAvailableFor(set: ScryfallSet): PackType[] {
  const released = set.released_at ?? "";
  const types: PackType[] = [];
  if (released >= "2024-02-01") types.push("play");
  types.push("draft");
  if (released >= "2019-10-01") types.push("collector");
  return types;
}
