import type { ScryfallCard } from "./scryfall";

/**
 * Convert a sealed deck into MTGA-importable text.
 *
 * MTGA's "Decks → Import" expects lines like:
 *   4 Lightning Bolt (LEA) 161
 *   1 Counterspell (TMP) 65
 *
 * For basic lands MTGA accepts `<n> Plains` etc. without set/number — Arena
 * picks a default basic. We still emit a set/number when we have one from
 * the player's pool so the deck stays visually consistent with the set
 * being drafted.
 *
 * The format is also accepted by most other importers (Untap, Cockatrice
 * via its MWS converter, Moxfield, Archidekt, etc.) so we don't need a
 * separate "deck list" mode.
 */
export interface DeckCardEntry {
  card: ScryfallCard;
  /** How many copies of this exact printing are in the deck. */
  count: number;
}

export interface BasicLandCounts {
  Plains: number;
  Island: number;
  Swamp: number;
  Mountain: number;
  Forest: number;
  Wastes: number;
}

/** Sample basic lands provided by the route layer when available — used to
 *  attribute a set + collector number to each basic land line. Optional;
 *  Arena resolves bare-name basics fine. */
export type BasicLandSamples = Partial<Record<keyof BasicLandCounts, ScryfallCard>>;

const BASIC_LAND_ORDER: (keyof BasicLandCounts)[] = [
  "Plains",
  "Island",
  "Swamp",
  "Mountain",
  "Forest",
  "Wastes",
];

/**
 * Group deck entries by Scryfall id (treating foil and non-foil printings
 * of the same card as a single line in the export — Arena doesn't
 * distinguish at import time anyway).
 */
export function groupDeckEntries(deck: ScryfallCard[]): DeckCardEntry[] {
  const byId = new Map<string, DeckCardEntry>();
  for (const card of deck) {
    const existing = byId.get(card.id);
    if (existing) {
      existing.count += 1;
    } else {
      byId.set(card.id, { card, count: 1 });
    }
  }
  // Sort: rarity desc → name asc, so the most exciting cards bubble to the
  // top of the exported list.
  const rarityRank: Record<string, number> = {
    mythic: 0, rare: 1, uncommon: 2, common: 3, special: 4, bonus: 5,
  };
  return Array.from(byId.values()).sort((a, b) => {
    const ra = rarityRank[a.card.rarity] ?? 9;
    const rb = rarityRank[b.card.rarity] ?? 9;
    if (ra !== rb) return ra - rb;
    return a.card.name.localeCompare(b.card.name);
  });
}

/**
 * Produce the importable text body for a deck. Cards section first,
 * basics appended at the end. No "Sideboard" block — sealed decks just
 * have a main 40-card list.
 */
export function exportDeckText(
  deck: ScryfallCard[],
  lands: BasicLandCounts,
  landSamples: BasicLandSamples = {},
): string {
  const lines: string[] = [];
  lines.push("Deck");
  for (const entry of groupDeckEntries(deck)) {
    lines.push(formatLine(entry.count, entry.card));
  }
  for (const name of BASIC_LAND_ORDER) {
    const n = lands[name];
    if (!n) continue;
    const sample = landSamples[name];
    if (sample) {
      lines.push(formatLine(n, sample));
    } else {
      lines.push(`${n} ${name}`);
    }
  }
  return lines.join("\n");
}

function formatLine(count: number, card: ScryfallCard): string {
  const setCode = card.set.toUpperCase();
  return `${count} ${card.name} (${setCode}) ${card.collector_number}`;
}

/**
 * Total card count = deck entries + sum of basic land counts. Used by the
 * builder header to surface progress toward the 40-card minimum.
 */
export function totalDeckSize(
  deck: ScryfallCard[],
  lands: BasicLandCounts,
): number {
  const fromLands = (Object.values(lands) as number[]).reduce(
    (s, n) => s + n,
    0,
  );
  return deck.length + fromLands;
}

export function emptyBasicLandCounts(): BasicLandCounts {
  return { Plains: 0, Island: 0, Swamp: 0, Mountain: 0, Forest: 0, Wastes: 0 };
}
