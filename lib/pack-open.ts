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
  predicateIsAltArtIntent,
  predicateMentionsLand,
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
 * Slot labels in the recipe JSON are nominal — e.g. a slot that can roll
 * either rare OR mythic is often labeled "Showcase Rare" or "Foil Rare"
 * for brevity. When the engine actually rolls a mythic into one of those
 * slots, displaying the unmodified label misleads the user (the rarity
 * chip in the modal correctly reads "Mythic", but the label above it
 * still says "Rare"). Conversely, a "Mythic" slot can roll a rare via
 * the rolled card's actual rarity, and we want the label to reflect that.
 *
 * Rules:
 *   - If the label already names both rarities ("Rare / Mythic",
 *     "Booster Fun Rare / Mythic"), leave it alone — it already covers
 *     both outcomes truthfully.
 *   - Otherwise swap the first rarity word (Common/Uncommon/Rare/Mythic)
 *     for the card's actual rarity, preserving any prefix like "Showcase"
 *     or "Foil".
 *   - Labels with no rarity word ("Foil", "Land", "Token") are unchanged.
 *
 * Used by CardDetailModal and PullSummary so the chip the user sees
 * always reconciles with the card itself.
 */
export function reconcileSlotLabel(
  slotLabel: string | undefined,
  actualRarity: string,
): string | undefined {
  if (!slotLabel) return slotLabel;
  // Already enumerates both rarities — no swap needed.
  if (
    /\brare\s*\/\s*mythic\b/i.test(slotLabel) ||
    /\bmythic\s*\/\s*rare\b/i.test(slotLabel)
  ) {
    return slotLabel;
  }
  // Title-case the actual rarity ("mythic" → "Mythic") so it matches the
  // existing label's capitalization scheme.
  const titleCased =
    actualRarity.charAt(0).toUpperCase() + actualRarity.slice(1).toLowerCase();
  // Replace the FIRST rarity word found; .replace with a non-global regex
  // does exactly that. Case-insensitive so we catch lowercase recipe
  // labels too.
  return slotLabel.replace(/\b(Common|Uncommon|Rare|Mythic)\b/i, titleCased);
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
 *   4. If `excludedIds` is non-empty, drop those card ids — this is how
 *      the engine prevents the same card from showing up twice in one
 *      pack (e.g. a slot with count:7 commons sampling with replacement
 *      from the same common pool would otherwise duplicate).
 *
 * Returns the constrained pool *after* the excludedIds filter. If the
 * filter would zero out the candidates (e.g. you've already taken every
 * unique card in that bucket), candidatesFor falls back to the
 * un-excluded list so the slot still produces a card — matches Wizards'
 * own packs which only allow within-pack duplicates when the set's pool
 * is genuinely too small.
 */
function candidatesFor(
  outcome: Outcome,
  pool: CardPool,
  ownSetCode: string,
  filters: Record<string, FilterPredicate>,
  excludedIds: Set<string>,
  isLandSlot: boolean,
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

  // Exclude basic lands from non-land slots. Basic lands have rarity
  // "common" on Scryfall, so without this filter they'd show up in any
  // common-rarity slot and a pack might contain multiple Plains. Lands
  // belong in the dedicated land slot (slot.basicLand: true) or in
  // outcomes that explicitly mention Land in their filter (spellcraft
  // lands, dual lands, etc.). Non-basic lands at the appropriate rarity
  // are still allowed in their rarity slot — real Magic packs can pull
  // a shock land in the rare slot.
  if (!isLandSlot && !predicateMentionsLand(predicate)) {
    const basicLand = resolveFilter(filters, "basic_land");
    if (basicLand) {
      out = out.filter((c) => !matchesFilter(c, basicLand));
    }
  }

  // English-by-default: Scryfall returns all language printings now that
  // include_multilingual=true is on, but most outcomes want the English
  // version. Only when the resolved filter explicitly mentions `lang` do
  // we let foreign-language printings through (e.g. the SOS Collector's
  // Japanese Mystical Archive outcomes opt in via `filter: "japanese"`).
  // Guarded the same way regular_print is — if filtering to English would
  // empty the candidate pool, keep the multilingual list so the outcome
  // can still produce a card (otherwise we fall into fallbackPull, which
  // is worse than yielding a foreign printing).
  if (!predicateMentionsLang(predicate)) {
    const englishOnly = out.filter(
      (c) => !c.lang || c.lang.toLowerCase() === "en",
    );
    if (englishOnly.length > 0) out = englishOnly;
  }

  // Basic-art by default: with unique=prints fetched from Scryfall a
  // common card with both regular + extended-art printings shows up
  // twice in the pool. Without this filter, an unbiased rarity-only
  // outcome would pick the alt-art half the time. Apply the regular_print
  // baseline unless the outcome's filter declares alt-art intent
  // (frame_effects / borderless / promo_types / non-en lang) — those
  // outcomes (SOS Booster Fun, Mystical Archive JP, etc.) deliberately
  // want alt-art treatment and skip this pass. The implicit filter is
  // also skipped if it would empty the candidate pool (rare sets where
  // no card has a "regular" printing in our sense).
  if (!predicateIsAltArtIntent(predicate)) {
    const regular = resolveFilter(filters, "regular_print");
    if (regular) {
      const regularOnly = out.filter((c) => matchesFilter(c, regular));
      if (regularOnly.length > 0) out = regularOnly;
    }
  }

  // Dedup within the pack — drop already-pulled card ids. Only apply
  // the filter if at least one card survives; otherwise the slot can't
  // produce anything and we'd hit fallbackPull, which is worse than
  // accepting a duplicate.
  if (excludedIds.size > 0) {
    const deduped = out.filter((c) => !excludedIds.has(c.id));
    if (deduped.length > 0) out = deduped;
  }

  return out;
}

/**
 * Try outcomes in weighted order. If the chosen outcome's candidate pool is
 * empty (e.g. a set we don't have cards for, or a filter that nobody in the
 * set matches), we discard it and re-roll over the remaining outcomes.
 */
function rollOutcome(
  outcomes: Outcome[],
  pool: CardPool,
  ownSetCode: string,
  filters: Record<string, FilterPredicate>,
  rng: () => number,
  excludedIds: Set<string>,
  isLandSlot: boolean,
): { outcome: Outcome; card: ScryfallCard } | null {
  const remaining: Outcome[] = outcomes.slice();
  while (remaining.length) {
    const chosen = pickWeighted(remaining, (o) => o.weight, rng);
    if (!chosen) return null;
    const candidates = candidatesFor(chosen, pool, ownSetCode, filters, excludedIds, isLandSlot);
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
 * Last-resort fallback when every outcome failed. Walks down rarities
 * looking for any card the pack hasn't already taken; only allows a
 * duplicate if the entire set bucket is exhausted.
 */
function fallbackPull(
  pool: CardPool,
  ownSetCode: string,
  rng: () => number,
  excludedIds: Set<string>,
  filters: Record<string, FilterPredicate>,
  isLandSlot: boolean,
): ScryfallCard | undefined {
  const own = ownSetCode.toLowerCase();
  let setCards = pool[own] ?? [];

  // English-by-default — match what candidatesFor does so a fall-through
  // doesn't suddenly produce a Spanish/German/etc. printing the primary
  // path would never have allowed. Only applies when at least one English
  // card exists for the set; otherwise the multilingual pool is kept so
  // we can still produce *some* card.
  const english = setCards.filter((c) => !c.lang || c.lang.toLowerCase() === "en");
  if (english.length > 0) setCards = english;

  // Basic-land exclusion — keeps the fallback from filling a non-land
  // slot with a basic just because the slot's normal candidates ran out.
  if (!isLandSlot) {
    const basicLand = resolveFilter(filters, "basic_land");
    if (basicLand) {
      const filtered = setCards.filter((c) => !matchesFilter(c, basicLand));
      if (filtered.length > 0) setCards = filtered;
    }
  }
  for (const r of ["common", "uncommon", "rare", "mythic"] as Rarity[]) {
    const tier = setCards.filter((c) => c.rarity === r && !excludedIds.has(c.id));
    if (tier.length) return pickFrom(tier, rng);
  }
  // Last resort — any card, including dupes if the pool's truly tiny.
  return pickFrom(setCards, rng);
}

/**
 * Module-level monotonic counter for PulledCard uids. Previously the
 * counter was scoped to each openPack call, restarting at 0 — fine for the
 * single-pack opener, but the sealed flow calls openPack 6× and the same
 * card pulled at the same slot index across packs ended up with identical
 * uids ("<id>#N"), causing React duplicate-key warnings and the deck
 * builder treating two different physical pulls as the same card.
 * A module-level counter makes uids unique across every call in a session.
 */
let GLOBAL_PULL_COUNTER = 0;

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
  const ownSet = setCode.toLowerCase();
  // Tracks card ids already pulled in this pack so we don't sample the
  // same card twice when a slot has count > 1. Tokens are kept in their
  // own bucket so a token can't shadow a main-set card with the same id
  // (extremely unlikely but defensive).
  const pickedIds = new Set<string>();
  const pickedTokenIds = new Set<string>();

  for (let s = 0; s < content.slots.length; s++) {
    const slot: SlotRecipe = content.slots[s];
    const count = slot.count ?? 1;

    for (let i = 0; i < count; i++) {
      const isLandSlot = !!slot.basicLand;

      if (slot.token) {
        // Token slots never want basic-land exclusion (token sets don't
        // contain lands anyway, but the flag is still well-defined).
        const rolled = rollOutcome(slot.outcomes, pool, ownSet, filters, rng, pickedTokenIds, false);
        if (!rolled) continue;
        pickedTokenIds.add(rolled.card.id);
        pulled.push({
          uid: `${rolled.card.id}#${GLOBAL_PULL_COUNTER++}`,
          card: rolled.card,
          slotIndex: s,
          slotLabel: slot.label,
          foil: !!slot.foil || !!rolled.outcome.foil,
          outcomeLabel: rolled.outcome.label,
          isToken: true,
        });
        continue;
      }

      const rolled = rollOutcome(slot.outcomes, pool, ownSet, filters, rng, pickedIds, isLandSlot);
      let card: ScryfallCard | undefined;
      let outcomeFoil = false;
      let outcomeLabel: string | undefined;
      if (rolled) {
        card = rolled.card;
        outcomeFoil = !!rolled.outcome.foil;
        outcomeLabel = rolled.outcome.label;
      } else {
        card = fallbackPull(pool, ownSet, rng, pickedIds, filters, isLandSlot);
      }
      if (!card) continue;
      pickedIds.add(card.id);

      pulled.push({
        uid: `${card.id}#${GLOBAL_PULL_COUNTER++}`,
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
