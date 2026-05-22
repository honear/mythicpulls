import type { ScryfallCard, Rarity } from "./scryfall";
import type { PackDefinition, SlotRule, PackType } from "./pack-rules";
import { PACKS } from "./pack-rules";

export interface PulledCard {
  /** Stable id — `${card.id}#${index}` ensures duplicate slots in one pack render separately. */
  uid: string;
  card: ScryfallCard;
  slotIndex: number;
  slotLabel: string;
  foil: boolean;
  /** True when this card was *upgraded* in the wildcard/foil/bonus slot. */
  highlight?: boolean;
}

/** Group cards by rarity bucket once per set, for fast repeated pulls. */
export interface RarityPool {
  common: ScryfallCard[];
  uncommon: ScryfallCard[];
  rare: ScryfallCard[];
  mythic: ScryfallCard[];
  basicLand: ScryfallCard[];
}

export function buildPool(cards: ScryfallCard[]): RarityPool {
  const pool: RarityPool = {
    common: [],
    uncommon: [],
    rare: [],
    mythic: [],
    basicLand: [],
  };
  for (const c of cards) {
    const type = c.type_line ?? c.card_faces?.[0]?.type_line ?? "";
    if (type.includes("Basic Land")) {
      pool.basicLand.push(c);
      continue;
    }
    switch (c.rarity) {
      case "common":
        pool.common.push(c);
        break;
      case "uncommon":
        pool.uncommon.push(c);
        break;
      case "rare":
        pool.rare.push(c);
        break;
      case "mythic":
        pool.mythic.push(c);
        break;
      // 'special' and 'bonus' fall into rare bucket so they can still show up
      case "special":
      case "bonus":
        pool.rare.push(c);
        break;
    }
  }
  return pool;
}

function pickRarity(
  weights: SlotRule["weights"],
  rng: () => number,
): Rarity | undefined {
  const entries = Object.entries(weights) as [Rarity, number][];
  const total = entries.reduce((s, [, w]) => s + (w ?? 0), 0);
  if (total <= 0) return undefined;
  let r = rng() * total;
  for (const [rarity, weight] of entries) {
    r -= weight ?? 0;
    if (r <= 0) return rarity;
  }
  return entries[entries.length - 1][0];
}

function pickFrom<T>(list: T[], rng: () => number): T | undefined {
  if (!list.length) return undefined;
  return list[Math.floor(rng() * list.length)];
}

/** Open one pack. Returns `cardCount` PulledCards. */
export function openPack(
  pool: RarityPool,
  packType: PackType,
  rng: () => number = Math.random,
): PulledCard[] {
  const def: PackDefinition = PACKS[packType];
  const pulled: PulledCard[] = [];
  let counter = 0;
  for (let i = 0; i < def.slots.length; i++) {
    const slot = def.slots[i];
    let card: ScryfallCard | undefined;

    if (slot.basicLand && pool.basicLand.length) {
      card = pickFrom(pool.basicLand, rng);
    } else {
      const rarity = pickRarity(slot.weights, rng);
      if (rarity) {
        const bucket = pool[rarity as keyof RarityPool] as ScryfallCard[] | undefined;
        if (bucket && bucket.length) card = pickFrom(bucket, rng);
      }
      // Fallback: walk down rarities until we find one.
      if (!card) {
        for (const r of ["common", "uncommon", "rare", "mythic"] as const) {
          if (pool[r].length) {
            card = pickFrom(pool[r], rng);
            if (card) break;
          }
        }
      }
    }

    if (!card) continue;

    pulled.push({
      uid: `${card.id}#${counter++}`,
      card,
      slotIndex: i,
      slotLabel: slot.label,
      foil: !!slot.foil,
      highlight:
        (slot.label.toLowerCase().includes("wildcard") ||
          slot.label.toLowerCase().includes("bonus")) &&
        (card.rarity === "rare" || card.rarity === "mythic"),
    });
  }
  return pulled;
}
