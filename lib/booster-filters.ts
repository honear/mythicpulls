import type { ScryfallCard } from "./scryfall";

/**
 * Tiny declarative predicate language for matching Scryfall cards. Used by
 * the booster recipe system to express "extended-art rare" or "borderless
 * Elder Dragon" without hard-coding each subset.
 *
 * A predicate is matched against a single card. Logical composition is via
 * `all` / `any` / `not`. Leaf checks read Scryfall fields directly. Arrays
 * mean "any of" (OR); scalar values are exact.
 *
 * Example (from data/filters.json):
 *   "borderless_edp_dual": {
 *     "all": [
 *       { "border_color": "borderless" },
 *       { "any": [
 *         { "frame_effects": "showcase" },
 *         { "type_line_includes": "Planeswalker" },
 *         { "type_line_includes": "Dual Land" }
 *       ]}
 *     ]
 *   }
 *
 * Fields supported:
 *   frame_effects        — array-includes-any on card.frame_effects
 *   border_color         — array-includes-any (or scalar) on card.border_color
 *   promo_types          — array-includes-any on card.promo_types
 *   layout               — array-includes-any (or scalar) on card.layout
 *   rarity               — array-includes-any on card.rarity
 *   lang                 — array-includes-any (or scalar) on card.lang
 *                          ("en", "ja", "de", "ru", "ko", "zhs", …)
 *   finishes             — array-includes-any on card.finishes
 *                          ("nonfoil" | "foil" | "etched" | "glossy")
 *   type_line_includes   — case-insensitive substring of card.type_line
 *   type_line_excludes   — negative of the above
 *   produced_mana        — array-includes-any on card.produced_mana
 *   collector_number_in  — list of literal collector_number strings
 *   collector_number_range — [from,to] numeric range on parseInt(collector_number)
 */
export interface FilterPredicate {
  frame_effects?: string | string[];
  border_color?: string | string[];
  promo_types?: string | string[];
  layout?: string | string[];
  rarity?: string | string[];
  lang?: string | string[];
  finishes?: string | string[];
  type_line_includes?: string;
  type_line_excludes?: string;
  produced_mana?: string | string[];
  /** card.frame — "1993" | "1997" | "2003" | "2015" | "future". Used for
   *  retro-frame treatments. */
  frame?: string | string[];
  /** card.full_art boolean — full-art lands / cards. */
  full_art?: boolean;
  collector_number_in?: string[];
  collector_number_range?: [number, number];
  not?: FilterPredicate;
  all?: FilterPredicate[];
  any?: FilterPredicate[];
}

function asArray<T>(v: T | T[] | undefined): T[] | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v : [v];
}

function anyOf(haystack: string[] | undefined, needle: string | string[]): boolean {
  if (!haystack || haystack.length === 0) return false;
  const wants = Array.isArray(needle) ? needle : [needle];
  return wants.some((w) => haystack.includes(w));
}

/** True when the card satisfies every leaf in the predicate. */
export function matchesFilter(card: ScryfallCard, p: FilterPredicate): boolean {
  if (p.all) return p.all.every((q) => matchesFilter(card, q));
  if (p.any) return p.any.some((q) => matchesFilter(card, q));
  if (p.not) return !matchesFilter(card, p.not);

  if (p.frame_effects && !anyOf(card.frame_effects, p.frame_effects)) return false;

  if (p.border_color) {
    const want = asArray(p.border_color)!;
    if (!card.border_color || !want.includes(card.border_color)) return false;
  }

  if (p.promo_types && !anyOf(card.promo_types, p.promo_types)) return false;

  if (p.layout) {
    const want = asArray(p.layout)!;
    if (!want.includes(card.layout)) return false;
  }

  if (p.rarity) {
    const want = asArray(p.rarity)!;
    if (!want.includes(card.rarity)) return false;
  }

  if (p.lang) {
    const want = asArray(p.lang)!;
    if (!card.lang || !want.includes(card.lang)) return false;
  }

  if (p.finishes && !anyOf(card.finishes, p.finishes)) return false;

  if (p.type_line_includes) {
    const tl = (card.type_line ?? card.card_faces?.[0]?.type_line ?? "").toLowerCase();
    if (!tl.includes(p.type_line_includes.toLowerCase())) return false;
  }
  if (p.type_line_excludes) {
    const tl = (card.type_line ?? card.card_faces?.[0]?.type_line ?? "").toLowerCase();
    if (tl.includes(p.type_line_excludes.toLowerCase())) return false;
  }

  if (p.produced_mana && !anyOf(card.produced_mana, p.produced_mana)) return false;

  if (p.frame) {
    const want = asArray(p.frame)!;
    if (!card.frame || !want.includes(card.frame)) return false;
  }
  if (p.full_art !== undefined) {
    if (Boolean(card.full_art) !== p.full_art) return false;
  }

  if (p.collector_number_in) {
    if (!p.collector_number_in.includes(card.collector_number)) return false;
  }
  if (p.collector_number_range) {
    const n = parseInt(card.collector_number, 10);
    if (Number.isNaN(n)) return false;
    const [lo, hi] = p.collector_number_range;
    if (n < lo || n > hi) return false;
  }

  return true;
}

/** Resolve a named filter from the filters registry. Returns undefined if
 *  not defined — callers should treat that as "no filter, pool is wide open". */
export function resolveFilter(
  filters: Record<string, FilterPredicate>,
  name: string | undefined,
): FilterPredicate | undefined {
  if (!name) return undefined;
  const f = filters[name];
  if (!f) {
    // eslint-disable-next-line no-console
    console.warn(`[booster-config] unknown filter: ${name}`);
    return undefined;
  }
  return f;
}

/**
 * True when the predicate mentions `lang` at any nesting level. Used by the
 * engine to decide whether to apply an implicit "English only" pass: pulls
 * with no explicit language constraint default to the English printing, so
 * a non-foil Mystical Archive outcome doesn't accidentally pull the Spanish
 * or German translation just because multilingual fetch is on at the
 * Scryfall layer.
 */
export function predicateMentionsLang(
  p: FilterPredicate | undefined,
): boolean {
  if (!p) return false;
  if (p.lang !== undefined) return true;
  if (p.all && p.all.some(predicateMentionsLang)) return true;
  if (p.any && p.any.some(predicateMentionsLang)) return true;
  if (p.not && predicateMentionsLang(p.not)) return true;
  return false;
}

/**
 * True when the predicate references "Land" in any type_line_includes
 * branch. The engine uses this to know whether an outcome is intentionally
 * targeting lands (basic land slot, spellcraft land, dual land, etc.) and
 * therefore should NOT have the implicit "exclude basic lands" filter
 * applied. Non-basic land slots like SOS's Spellcraft Land work because
 * their filter mentions Land in its type_line.
 */
export function predicateMentionsLand(
  p: FilterPredicate | undefined,
): boolean {
  if (!p) return false;
  if (p.type_line_includes && p.type_line_includes.toLowerCase().includes("land")) return true;
  if (p.all && p.all.some(predicateMentionsLand)) return true;
  if (p.any && p.any.some(predicateMentionsLand)) return true;
  if (p.not && predicateMentionsLand(p.not)) return true;
  return false;
}

/**
 * True when the predicate declares "I'm intentionally pulling an alt-art
 * printing." The engine uses this to decide whether to apply the implicit
 * `regular_print` baseline. If the filter already names a treatment field
 * (frame_effects, borderless border_color, promo_types) or asks for a
 * non-English language printing (which on Scryfall correlates with
 * alt-art Japanese variants), we skip the regular_print pass so the
 * outcome's explicit intent isn't overruled.
 */
export function predicateIsAltArtIntent(
  p: FilterPredicate | undefined,
): boolean {
  if (!p) return false;
  if (p.frame_effects !== undefined) return true;
  if (p.border_color !== undefined) {
    const colors = Array.isArray(p.border_color) ? p.border_color : [p.border_color];
    if (colors.includes("borderless")) return true;
  }
  if (p.promo_types !== undefined) return true;
  // Retro frame + full-art are alt-art treatments; skip regular_print (which
  // would otherwise exclude frame_effects:"fullart" and boosterfun retros).
  if (p.frame !== undefined) return true;
  if (p.full_art !== undefined) return true;
  if (p.lang !== undefined) {
    const langs = Array.isArray(p.lang) ? p.lang : [p.lang];
    if (langs.some((l) => l !== "en")) return true;
  }
  if (p.all && p.all.some(predicateIsAltArtIntent)) return true;
  if (p.any && p.any.some(predicateIsAltArtIntent)) return true;
  // `not` is intentionally not recursed — "not borderless" doesn't mean
  // the outcome wants alt-art; treat that as not-alt-art-intent.
  return false;
}
