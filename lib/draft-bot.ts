import type { ScryfallCard } from "./scryfall";
import type { PulledCard } from "./pack-open";

/* ===========================================================================
   Draft bot — weighted picker.
   ---------------------------------------------------------------------------
   Three components blended with weights that shift across the draft:

     • Rarity   — dominant in the opening picks (chase mythics/rares).
     • Color    — zero until the bot has enough cards to read a signal,
                  then ramps aggressively so once a bot commits, it
                  refuses off-color cards even if they're mythic.
     • Curve    — soft brake on stacking 5+ cards at the same mana value;
                  only matters once the deck shape exists.

   Curve we apply (poolSize → weights):

     t = max(0, min(1, (poolSize - 4) / 14))
                       ^^^                  ^^^
            zero until pick 5,    full lock from pick 18 onward
     rarity = 1.0 - 0.6 * t   →  pick 0..4: 1.00,  pick 18+: 0.40
     color  = 0.0 + 3.0 * t   →  pick 0..4: 0.00,  pick 18+: 3.00
     curve  = 0.0 + 0.7 * t   →  pick 0..4: 0.00,  pick 18+: 0.70

   Crossover map (mythic off-color vs in-color rare vs in-color common):

     pick 4   · mythic off-color → 1.00*6 - 0.00*1.5 = 6.00 ← takes mythic
              · rare in-color    → 1.00*4 + 0.00*1.0 = 4.00
              (rarity dominates absolutely; mythic ALWAYS wins early)

     pick 8   · mythic off-color → 0.83*6 - 0.86*1.5 = 3.70
              · rare in-color    → 0.83*4 + 0.86*1.0 = 4.18  ← takes rare
              (color preference starts mattering; in-color rares now beat
               off-color mythics)

     pick 14  · mythic off-color → 0.57*6 - 2.14*1.5 = 0.21
              · common in-color  → 0.57*1 + 2.14*1.0 = 2.71  ← takes common
              (bot committed; even a common in its colors beats an
               off-color mythic — your "14 white cards, red mythic" case)

     pick 18+ · mythic off-color → 0.40*6 - 3.00*1.5 = -2.10
              · common in-color  → 0.40*1 + 3.00*1.0 =  3.40
              · mythic in-color  → 0.40*6 + 3.00*1.0 =  5.40 ← takes mythic
              (in-color mythics still chased eagerly; off-color
               picks are below zero — won't happen)

   dominantColors weights occurrences by rarity, so a bot's "colors"
   reflect where its best cards live, not just where it took the most
   picks — one rare in a color carries 4× the signaling weight of one
   common in that color.
   =========================================================================== */

const RARITY_BASE: Record<string, number> = {
  mythic: 6,
  rare: 4,
  uncommon: 2,
  common: 1,
  special: 3,
  bonus: 3,
};

const ALL_COLORS = ["W", "U", "B", "R", "G"] as const;
type Color = (typeof ALL_COLORS)[number];

interface BotWeights {
  rarity: number;
  color: number;
  curve: number;
}

function botWeights(poolSize: number): BotWeights {
  // t stays at 0 through pick 4 (rarity-only chase, no color preference
  // even though dominantColors may have started returning values), then
  // ramps to 1 over the next 14 picks (saturates at pick 18). After that,
  // weights are pinned at the color-lock end of the curve.
  const t = Math.max(0, Math.min(1, (poolSize - 4) / 14));
  return {
    rarity: 1.0 - 0.6 * t,
    color: 0.0 + 3.0 * t,
    curve: 0.0 + 0.7 * t,
  };
}

/**
 * The bot's "developing colors". Returns the top 2 colors in the pool
 * weighted by each pick's rarity, so a rare card in red counts more
 * toward red-identity than three common reds. Stays empty for the first
 * few picks so early-draft scoring is pure rarity chase.
 */
function dominantColors(pool: PulledCard[]): Color[] {
  if (pool.length < 4) return [];
  const counts = new Map<Color, number>();
  for (const p of pool) {
    const rarityWeight = RARITY_BASE[p.card.rarity] ?? 1;
    const colors = (p.card.colors ?? []) as Color[];
    for (const c of colors) {
      counts.set(c, (counts.get(c) ?? 0) + rarityWeight);
    }
  }
  if (counts.size === 0) return [];
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([c]) => c);
}

/** Soft brake — discourages stacking too many of the same mana value. */
function curveOverloaded(pool: PulledCard[], cmc: number | undefined): boolean {
  if (cmc == null) return false;
  const bucket = Math.min(7, Math.max(0, Math.round(cmc)));
  let count = 0;
  for (const p of pool) {
    const c = Math.min(7, Math.max(0, Math.round(p.card.cmc ?? 0)));
    if (c === bucket) count += 1;
  }
  return count >= 5;
}

function isLand(card: ScryfallCard): boolean {
  return (card.type_line ?? "").toLowerCase().includes("land");
}

function scoreCard(
  candidate: PulledCard,
  myColors: Color[],
  pool: PulledCard[],
): number {
  const w = botWeights(pool.length);
  const card = candidate.card;

  // Rarity contribution — scaled by the rarity weight (fades over time).
  let score = w.rarity * (RARITY_BASE[card.rarity] ?? 1);

  if (candidate.foil) score += 0.5;

  // Lands: useful as fixing once we have 2+ colors locked.
  if (isLand(card)) {
    if (myColors.length >= 2) score += 0.5 * w.color;
    return score;
  }

  // No colors developed yet — pure rarity grab, ignore color signaling.
  if (myColors.length === 0) return score;

  const cardColors = (card.colors ?? []) as Color[];
  if (cardColors.length === 0) {
    // Colorless artifacts work in any deck — small bonus, scaled by color weight.
    score += 0.4 * w.color;
  } else {
    const inColor = cardColors.every((c) => myColors.includes(c));
    if (inColor) {
      score += 1.0 * w.color;
    } else {
      // Off-color penalty — also scaled by color weight, so early it's a
      // tap and late it's a wrecking ball.
      score -= 1.5 * w.color;
    }
  }

  if (curveOverloaded(pool, card.cmc)) score -= w.curve;

  // Tiny jitter so identical packs don't always produce identical bot picks.
  score += Math.random() * 0.05;

  return score;
}

/**
 * Pick the best card from a pack for a bot with the given pool. Caller
 * is responsible for moving the card to the bot's pool and shrinking
 * the pack.
 */
export function botPick(
  pack: PulledCard[],
  pool: PulledCard[],
): PulledCard {
  if (pack.length === 0) {
    throw new Error("botPick called with empty pack");
  }
  if (pack.length === 1) return pack[0];

  const myColors = dominantColors(pool);
  let best = pack[0];
  let bestScore = scoreCard(best, myColors, pool);
  for (let i = 1; i < pack.length; i++) {
    const s = scoreCard(pack[i], myColors, pool);
    if (s > bestScore) {
      best = pack[i];
      bestScore = s;
    }
  }
  return best;
}
