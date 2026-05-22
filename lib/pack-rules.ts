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
}

export interface PackDefinition {
  type: PackType;
  name: string;
  tagline: string;
  cardCount: number;
  /** Slot list applied top to bottom; one card per slot. */
  slots: SlotRule[];
}

/**
 * Mythic ratio in the rare slot of modern boosters is ~1 in 7.4
 * (≈13.5% mythic / 86.5% rare). We encode it as integer weights.
 */
const RARE_MYTHIC = { rare: 86, mythic: 14 } as const;

/**
 * Wildcard slot in Play Boosters is roughly:
 *  ~70% common, ~20% uncommon, ~8% rare, ~2% mythic.
 * (Wizards has published per-set variations; this is a faithful average.)
 */
const WILDCARD = { common: 70, uncommon: 20, rare: 8, mythic: 2 } as const;

/** Foil slot rarity distribution — roughly 67/20/10/3 c/u/r/m. */
const FOIL_WILDCARD = { common: 67, uncommon: 20, rare: 10, mythic: 3 } as const;

export const PACKS: Record<PackType, PackDefinition> = {
  play: {
    type: "play",
    name: "Play Booster",
    tagline: "14 cards · 1 rare/mythic · 1 traditional foil · modern standard",
    cardCount: 14,
    slots: [
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
    tagline: "15 cards · 1 rare/mythic · 1 basic land · the classic format",
    cardCount: 15,
    slots: [
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
    tagline: "15 premium cards · all foil/showcase · the chase pack",
    cardCount: 15,
    slots: [
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
  // Collector Boosters are a modern construct — only suggest for 2018+ sets.
  const released = set.released_at ?? "";
  const types: PackType[] = [];
  if (released >= "2024-02-01") types.push("play");
  types.push("draft");
  if (released >= "2019-10-01") types.push("collector");
  return types;
}
