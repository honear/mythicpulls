import type { ScryfallCard } from "./scryfall";
import type {
  Outcome,
  PackContent,
  Rarity,
  SlotRecipe,
} from "./booster-config";
import { resolveSetSentinel } from "./booster-config";
import {
  matchesFilter,
  predicateMentionsLang,
  resolveFilter,
  type FilterPredicate,
} from "./booster-filters";

export interface PulledCard {
  /** Stable id — `${card.id}#${index}` so duplicates render separately. */
  uid: string;
  card: ScryfallCard;
  slotIndex: number;
  slotLabel: string;
  foil: boolean;
  /** Optional sub-label set on an Outcome (e.g. "Special Guest", "Japanese"). */
  outcomeLabel?: string;
  /** True when the slot is the pack's token (always rendered first). */
  isToken?: boolean;
}

/**
 * Multi-set card pool. Keys are lowercased Scryfall set codes; values are
 * the cards from that set already filtered for booster eligibility (no
 * digital, no oversized, no art_series — same hygiene as getSetCards).
 *
 * The pack engine looks up `pool[outcome.set]` for each outcome and falls
 * back to the pack's own set when an outcome omits `set`.
 */
export type CardPool = Record<string, ScryfallCard[]>;

/** Backwards-compatible wrapper around the legacy single-set + tokens
 *  call site. New call sites should construct CardPool directly. */
export function buildPool(
  cards: ScryfallCard[],
  tokens: ScryfallCard[] = [],
  setCode = "",
): CardPool {
  const own = setCode.toLowerCase();
  const pool: CardPool = {};
  if (own) pool[own] = cards;
  if (tokens.length) pool[`t${own}`] = tokens;
  return pool;
}

function pickWeighted<T>(items: T[], weight: (t: T) => number, rng: () => number): T | undefined {
  let total = 0;
  for (const it of items) total += weight(it);
  if (total <= 0) return undefined;
  let r = rng() * total;
  for (const it of items) {
    r -= weight(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

function pickFrom<T>(list: T[], rng: () => number): T | undefined {
  if (!list.length) return undefined;
  return list[Math.floor(rng() * list.length)];
}

/**
 * Build the candidate-card list for a single outcome:
 *   1. Get cards from the appropriate set (outcome.set or the pack's own).
 *   2. If outcome.rarity is set, restrict to that rarity.
 *   3. If outcome.filter is set, restrict by the named filter predicate.
 */
function candidatesFor(
  outcome: Outcome,
  pool: CardPool,
  ownSetCode: string,
  filters: Record<string, FilterPredicate>,
): ScryfallCard[] {
  const target = resolveSetSentinel(outcome.set, ownSetCode) ?? ownSetCode.toLowerCase();
  const setCards = pool[target] ?? [];
  if (!setCards.length) return [];

  let out = setCards;
  if (outcome.rarity) {
    out = out.filter((c) => c.rarity === outcome.rarity);
  }
  const predicate = resolveFilter(filters, outcome.filter);
  if (predicate) {
    out = out.filter((c) => matchesFilter(c, predicate));
  }

  // English-by-default: Scryfall returns all language printings now that
  // include_multilingual=true is on, but most outcomes want the English
  // version. Only when the resolved filter explicitly mentions `lang` do
  // we let foreign-language printings through (e.g. the SOS Collector's
  // Japanese Mystical Archive outcomes opt in via `filter: "japanese"`).
  if (!predicateMentionsLang(predicate)) {
    out = out.filter((c) => !c.lang || c.lang === "en");
  }

  return out;
}

/**
 * Try outcomes in weighted order. If the chosen outcome's candidate pool is
 * empty (e.g. a set we don't have cards for, or a filter that nobody in the
 * set matches), we discard it and re-roll over the remaining outcomes. That
 * keeps the pack opening robust against missing data — a recipe that
 * references SOA cards still works if SOA failed to load (we just skip the
 * SOA outcomes for that slot).
 */
function rollOutcome(
  outcomes: Outcome[],
  pool: CardPool,
  ownSetCode: string,
  filters: Record<string, FilterPredicate>,
  rng: () => number,
): { outcome: Outcome; card: ScryfallCard } | null {
  // Each pass picks one outcome by weight from the pool of "still viable"
  // outcomes — meaning outcomes whose candidate set isn't empty.
  const remaining: Outcome[] = outcomes.slice();
  while (remaining.length) {
    const chosen = pickWeighted(remaining, (o) => o.weight, rng);
    if (!chosen) return null;
    const candidates = candidatesFor(chosen, pool, ownSetCode, filters);
    if (candidates.length) {
      const card = pickFrom(candidates, rng);
      if (card) return { outcome: chosen, card };
    }
    const i = remaining.indexOf(chosen);
    if (i >= 0) remaining.splice(i, 1);
  }
  return null;
}

/**
 * Last-resort fallback when every outcome failed (e.g. the set has zero
 * cards at the chosen rarity). Walk down rarities until we find anything.
 * This preserves the old engine's behavior of never producing an "empty"
 * slot when there's at least one card in the pool somewhere.
 */
function fallbackPull(
  pool: CardPool,
  ownSetCode: string,
  rng: () => number,
): ScryfallCard | undefined {
  const own = ownSetCode.toLowerCase();
  const setCards = pool[own] ?? [];
  for (const r of ["common", "uncommon", "rare", "mythic"] as Rarity[]) {
    const tier = setCards.filter((c) => c.rarity === r);
    if (tier.length) return pickFrom(tier, rng);
  }
  return pickFrom(setCards, rng);
}

/**
 * Open one pack. Walks the slot recipes, expanding each by its `count`
 * (default 1), rolling an outcome per slot pull, and emitting a PulledCard
 * per result. Token slots fall back to the conventional `t<set>` pool;
 * if that pool is empty (set has no tokens), the slot is silently skipped.
 */
export function openPack(
  content: PackContent,
  pool: CardPool,
  setCode: string,
  filters: Record<string, FilterPredicate>,
  rng: () => number = Math.random,
): PulledCard[] {
  const pulled: PulledCard[] = [];
  let counter = 0;
  const ownSet = setCode.toLowerCase();

  for (let s = 0; s < content.slots.length; s++) {
    const slot: SlotRecipe = content.slots[s];
    const count = slot.count ?? 1;

    for (let i = 0; i < count; i++) {
      // Token slots roll their outcomes the same way every other slot does
      // (so a "token OR art card" slot can mix outcomes with different
      // weights and sets), but they silently skip the entire slot if every
      // outcome's pool is empty — this is how a set with no tokens or
      // art cards degrades gracefully without forcing an off-spec fallback.
      if (slot.token) {
        const rolled = rollOutcome(slot.outcomes, pool, ownSet, filters, rng);
        if (!rolled) continue;
        pulled.push({
          uid: `${rolled.card.id}#${counter++}`,
          card: rolled.card,
          slotIndex: s,
          slotLabel: slot.label,
          foil: !!slot.foil || !!rolled.outcome.foil,
          outcomeLabel: rolled.outcome.label,
          isToken: true,
        });
        continue;
      }

      const rolled = rollOutcome(slot.outcomes, pool, ownSet, filters, rng);
      let card: ScryfallCard | undefined;
      let outcomeFoil = false;
      let outcomeLabel: string | undefined;
      if (rolled) {
        card = rolled.card;
        outcomeFoil = !!rolled.outcome.foil;
        outcomeLabel = rolled.outcome.label;
      } else {
        card = fallbackPull(pool, ownSet, rng);
      }
      if (!card) continue;

      pulled.push({
        uid: `${card.id}#${counter++}`,
        card,
        slotIndex: s,
        slotLabel: slot.label,
        foil: !!slot.foil || outcomeFoil,
        outcomeLabel,
      });
    }
  }

  return pulled;
}
