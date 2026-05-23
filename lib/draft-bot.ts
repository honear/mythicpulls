import type { ScryfallCard } from "./scryfall";
import type { PulledCard } from "./pack-open";
import { getCardStat } from "./draft-stats";

/* ===========================================================================
   Draft bot — weighted picker.
   ---------------------------------------------------------------------------
   Three components blended with weights that shift across the draft:

     • Rarity   — dominant in the opening picks (chase mythics/rares).
     • Color    — zero until the bot has enough cards to read a signal,
                  then ramps so once a bot commits, it prefers in-color
                  but still wakes up for big off-color rarity bumps.
     • Curve    — soft brake on stacking 5+ cards at the same mana value;
                  only matters once the deck shape exists.

   Curve we apply (poolSize → weights):

     t = max(0, min(1, (poolSize - 6) / 16))
                       ^^^                  ^^^
            zero until pick 7,    full lock from pick 22 onward
     rarity = 1.0 - 0.5 * t   →  pick 0..6: 1.00,  pick 22+: 0.50
     color  = 0.0 + 2.5 * t   →  pick 0..6: 0.00,  pick 22+: 2.50
     curve  = 0.0 + 0.7 * t   →  pick 0..6: 0.00,  pick 22+: 0.70

   Earlier tuning had the bot committing to colors hard by pick 14
   (in-color common beat off-color mythic). That played too tight —
   real drafters happily take a rare off-color and figure out the
   splash. The new ramp delays color-lock (start at pick 7, top out at
   pick 22) and lowers the color cap from 3.0 → 2.5, so rarity keeps
   meaningful weight throughout.

   Multi-color cards now get partial credit when ONE of their colors
   matches the bot's pair (gold-card splash). A W/R card in front of a
   W/U bot used to score as full off-color; now it lands between
   in-color (+1.0 * color) and off-color (-1.0 * color) at about
   +0.4 * color — drafters splash these.

   Crossover map (with new tuning):

     pick 6   · mythic off-color → 1.00*6 - 0.00*1.0 = 6.00 ← takes mythic
              · rare in-color    → 1.00*4 + 0.00*1.0 = 4.00
              (rarity dominates absolutely; mythic ALWAYS wins early)

     pick 14  · mythic off-color → 0.75*6 - 1.25*1.0 = 3.25
              · rare in-color    → 0.75*4 + 1.25*1.0 = 4.25  ← takes rare
              · common in-color  → 0.75*1 + 1.25*1.0 = 2.00
              · mythic splash    → 0.75*6 + 1.25*0.4 = 5.00  ← splash wins
              (a one-color-shared mythic beats an in-color rare — the
               bot grabs it and adapts. An out-of-colors mythic still
               loses to an in-color rare.)

     pick 22+ · mythic off-color → 0.50*6 - 2.50*1.0 = 0.50
              · common in-color  → 0.50*1 + 2.50*1.0 = 3.00
              · mythic in-color  → 0.50*6 + 2.50*1.0 = 5.50 ← takes mythic
              (late draft: in-color commons clearly beat off-color
               mythics. The bot's deck is built.)

   dominantColors weights occurrences by rarity, so a bot's "colors"
   reflect where its best cards live, not just where it took the most
   picks — one rare in a color carries 4× the signaling weight of one
   common in that color. A multi-color card adds to ALL of its colors,
   so a Boros rare contributes 4 to both W and R.
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
  // t stays at 0 through pick 6 (rarity-only chase, no color preference
  // even though dominantColors may have started returning values), then
  // ramps to 1 over the next 16 picks (saturates at pick 22). After that,
  // weights are pinned at the color-lock end of the curve. Tuned softer
  // than the previous (pick-4 → pick-18) ramp so bots are still willing
  // to grab a power-level off-color rare/mythic mid-draft instead of
  // locking onto an in-color common.
  const t = Math.max(0, Math.min(1, (poolSize - 6) / 16));
  return {
    rarity: 1.0 - 0.5 * t,
    color: 0.0 + 2.5 * t,
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

/** Coefficient on the 17Lands GIH-WR quality bump. (gihWr − 0.5) is
 *  scaled by 20 to land in roughly ±2 for ±10 % WR; we then multiply
 *  by this weight so a 55 % WR card adds ~+1.0, a 45 % WR card ~−1.0.
 *  Big enough to promote a great uncommon over a mediocre rare, small
 *  enough not to override the rarity chase early or color-lock late. */
const QUALITY_WEIGHT = 0.5;

/** Fallback quality bump when GIH WR is unavailable but the card has a
 *  meaningful ATA reading. Cards taken in the first 4 picks get a small
 *  positive nudge, cards passed past pick 12 get a small negative one.
 *  Used for sets with thin sample sizes or rarely-played cards. */
const ATA_WEIGHT = 0.2;

function scoreCard(
  candidate: PulledCard,
  myColors: Color[],
  pool: PulledCard[],
  setCode?: string,
): number {
  const w = botWeights(pool.length);
  const card = candidate.card;

  // Rarity contribution — scaled by the rarity weight (fades over time).
  let score = w.rarity * (RARITY_BASE[card.rarity] ?? 1);

  if (candidate.foil) score += 0.5;

  // 17Lands quality signal — uses the set's draft-stats aggregate when
  // we have data for it. GIH WR (Games-In-Hand Win Rate) is the cleanest
  // signal we get from 17Lands; it's centered on 0.50 (50 %) so we
  // recenter and scale. Bots with this data prefer a 58 %-WR uncommon
  // over a 47 %-WR rare in the same pack, which matches how an
  // experienced human drafter behaves. Cards with no aggregate (e.g.
  // sets we don't ship data for, or cards under the sample-size floor)
  // skip this contribution and behave exactly as before — rarity rules.
  const stat = setCode ? getCardStat(setCode, card.name) : null;
  if (stat?.gihWr != null) {
    score += QUALITY_WEIGHT * (stat.gihWr - 0.5) * 20;
  } else if (stat?.ata != null) {
    // Fallback: invert ATA. The pivot is pick 8 (mid-pack — average
    // card); a card with ATA 2 gets +1.2, ATA 14 gets −1.2.
    score += ATA_WEIGHT * (8 - stat.ata) / 5;
  }

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
    // Three-tier color match for multi-color cards:
    //   - inAll: every color of the card is in the bot's pair → full in-color bonus
    //   - inAny (but not inAll): card shares ONE color with the bot's pair, i.e.
    //                             it's a splashable gold card → ~half the in-color
    //                             bonus. Used to be treated as full off-color, which
    //                             made bots ignore obviously-good multi-color cards.
    //   - none: no shared colors → off-color penalty (softened from -1.5 → -1.0
    //                              so a chase mythic still has a shot)
    const inAll = cardColors.every((c) => myColors.includes(c));
    const inAny = !inAll && cardColors.some((c) => myColors.includes(c));
    if (inAll) {
      score += 1.0 * w.color;
    } else if (inAny) {
      score += 0.4 * w.color;
    } else {
      score -= 1.0 * w.color;
    }
  }

  if (curveOverloaded(pool, card.cmc)) score -= w.curve;

  // Per-card jitter ±0.4. This is the dominant source of bot variance —
  // close-score candidates flip between picks without changing the
  // overall "I like rares in my colors" behaviour. Compared with the
  // earlier ±0.025 tiebreaker, this lets a bot occasionally grab a card
  // that's a fraction of a point off the optimum, the way a human
  // drafter would value flavour / art / familiarity over a marginal
  // rating gap.
  score += (Math.random() - 0.5) * 0.8;

  return score;
}

/**
 * Pick the best card from a pack for a bot with the given pool. Caller
 * is responsible for moving the card to the bot's pool and shrinking
 * the pack.
 *
 * Most of the time the bot takes the top-scoring card. A small fraction
 * of picks take the 2nd or 3rd-best card instead, mimicking the way a
 * human drafter occasionally picks the flashier card, hate-picks a
 * sideways-good rare, or just disagrees with the "obvious" pick. A
 * safety cap stops it from making real blunders: the runner-up only
 * gets picked if it's within MAX_SPICE_GAP points of the top score.
 */
const PICK_TOP_RATE = 0.85;       // 85% of picks → top-scored card
const PICK_SECOND_RATE = 0.97;    // 12% → #2 (between 0.85 and 0.97)
                                  //  3% → #3
const MAX_SPICE_GAP = 1.5;        // never pick a card that's more than
                                  // 1.5 points worse than the optimum

export function botPick(
  pack: PulledCard[],
  pool: PulledCard[],
  setCode?: string,
): PulledCard {
  if (pack.length === 0) {
    throw new Error("botPick called with empty pack");
  }
  if (pack.length === 1) return pack[0];

  const myColors = dominantColors(pool);
  // Score every card up front so we can sort and probe the top-K. The
  // setCode propagates into scoreCard so the 17Lands GIH-WR contribution
  // can consult the right per-set aggregate.
  const scored = pack.map((p) => ({ card: p, score: scoreCard(p, myColors, pool, setCode) }));
  scored.sort((a, b) => b.score - a.score);

  const top = scored[0];
  const roll = Math.random();
  let pickIndex = 0;
  if (roll > PICK_SECOND_RATE && scored.length > 2) {
    pickIndex = 2;
  } else if (roll > PICK_TOP_RATE && scored.length > 1) {
    pickIndex = 1;
  }
  if (pickIndex === 0) return top.card;

  // Spice guard: a #2 or #3 pick only stands if its score is close to the
  // top. Otherwise fall back to the optimum — keeps bots from passing a
  // mythic for a common just to be quirky.
  const candidate = scored[pickIndex];
  if (top.score - candidate.score > MAX_SPICE_GAP) return top.card;
  return candidate.card;
}
