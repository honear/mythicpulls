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
  /** Default USD MSRP — overridable per-set via PACK_MSRP_OVERRIDES below. */
  costUsd: number;
}

/* ---------- Distribution constants (publicly-documented rates) ----------
 *
 * These weights model what's printed on the back of the box, summarized in
 * Wizards' own product-page tables and corroborated on the MTG Fandom wiki:
 *
 *   • Modern boosters (Play/Draft) hit a mythic rare roughly once every
 *     7.4 packs — about 13.5% mythic, 86.5% rare in the rare slot.
 *
 *   • The Play Booster "wildcard" slot (introduced with MKM in Feb 2024)
 *     skews heavily common: roughly 70% common / 20% uncommon / 8% rare /
 *     2% mythic.
 *
 *   • The traditional-foil slot follows a similar curve but slightly more
 *     generous to the higher rarities — roughly 67/20/10/3 c/u/r/m.
 *
 * These are integer-weighted so a weighted-random pull is exact (no
 * floating-point bias).
 */
const RARE_MYTHIC = { rare: 86, mythic: 14 } as const;
const WILDCARD = { common: 70, uncommon: 20, rare: 8, mythic: 2 } as const;
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
    /* Real Play Booster, per Wizards' product page (post-MKM, Feb 2024):
     *   7 commons · 3 uncommons · 1 wildcard · 1 rare/mythic ·
     *   1 traditional foil (any rarity) · 1 basic land · 1 token
     *
     * Earlier we added a tail "Bonus rare/mythic" slot which gave Play two
     * guaranteed rare/mythics — that overlapped Collector's premium feel.
     * Restored to the published distribution so Play sits cleanly between
     * Draft (1 R/M) and Collector (5 R/M).
     */
    slots: [
      TOKEN_SLOT,
      { label: "Common", weights: { common: 1 } },
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

/* ---------- Per-set MSRP overrides ----------
 *
 * Wizards prices Collector Boosters differently from one set to the next.
 * Numbers here are the published MSRPs at print time — secondary-market
 * prices (e.g. MTGGoldfish, TCGplayer) drift constantly and are not
 * exposed through a free public API, so we anchor on MSRPs and let the
 * user reason about the gap themselves.
 *
 * Anything missing falls back to the PackDefinition.costUsd default.
 */
const PACK_MSRP_OVERRIDES: Record<string, Partial<Record<PackType, number>>> = {
  // Collector premiums — Wizards has priced LotR-tier and Universes Beyond
  // sets noticeably above standard releases.
  ltr: { collector: 34.99 },
  fin: { collector: 34.99 },     // Final Fantasy
  ltc: { collector: 34.99 },
  fdn: { collector: 39.99 },     // Foundations
  // Recent expansions hovering around the $25-30 line:
  dsk: { collector: 24.99 },
  blb: { collector: 24.99 },
  otj: { collector: 27.99 },
  mh3: { collector: 31.99 },     // Modern Horizons 3 is premium
  lci: { collector: 23.99 },
  woe: { collector: 23.99 },
  ltc_: { collector: 34.99 },
};

/** Look up a pack's USD MSRP for a specific set. Falls back to the
 *  pack-type default when there's no per-set override. */
export function getPackCost(packType: PackType, setCode?: string): number {
  if (setCode) {
    const code = setCode.toLowerCase();
    const override = PACK_MSRP_OVERRIDES[code]?.[packType];
    if (typeof override === "number") return override;
  }
  return PACKS[packType].costUsd;
}

/**
 * Recommend a pack type based on the set's release date.
 * Play Booster format rolled out fully with MKM (February 2024).
 */
export function recommendedPackType(set: ScryfallSet): PackType {
  const released = set.released_at ?? "";
  if (released >= "2024-02-01") return "play";
  return "draft";
}

/**
 * Which pack types we surface for a given set. We're generous: we let users
 * try any pack type on any set, but mark a default. This is a fan project,
 * not a perfect simulation of Wizards' SKU history.
 *
 * Note: real Collector Boosters for some sets include set-specific "variant"
 * slots — e.g. Strixhaven (STX) packs include cards from Mystical Archive
 * (STA); March of the Machine (MOM) includes Multiverse Legends (MUL);
 * Outlaws of Thunder Junction (OTJ) includes Breaking News (OTP). We don't
 * inject these yet; the variant pool would need a second Scryfall fetch
 * per set. See notes/DEVELOPMENT_LOG.md → "Open follow-ups".
 */
export function packsAvailableFor(set: ScryfallSet): PackType[] {
  const released = set.released_at ?? "";
  const types: PackType[] = [];
  if (released >= "2024-02-01") types.push("play");
  types.push("draft");
  if (released >= "2019-10-01") types.push("collector");
  return types;
}
