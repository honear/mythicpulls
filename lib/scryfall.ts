/**
 * Minimal typed Scryfall client.
 *
 * Notes:
 * - Scryfall asks for a custom UA + Accept header and ≥ 50ms between requests.
 *   Server-side fetches are cached with Next.js revalidation, so traffic stays light.
 * - We only model the fields the app actually consumes.
 */

const BASE = "https://api.scryfall.com";

const HEADERS: HeadersInit = {
  "Accept": "application/json",
  "User-Agent": "ThreeTreeCity/0.1 (https://github.com/local; pack-opening sim)",
};

export type Rarity = "common" | "uncommon" | "rare" | "mythic" | "special" | "bonus";

export interface ScryfallSet {
  id: string;
  code: string;
  name: string;
  released_at?: string;
  set_type: string;
  card_count: number;
  digital: boolean;
  nonfoil_only?: boolean;
  foil_only?: boolean;
  icon_svg_uri?: string;
  block?: string;
  block_code?: string;
  booster: boolean;
}

export interface ScryfallCardFace {
  name: string;
  image_uris?: ScryfallImageUris;
  mana_cost?: string;
  type_line?: string;
}

export interface ScryfallImageUris {
  small?: string;
  normal?: string;
  large?: string;
  png?: string;
  art_crop?: string;
  border_crop?: string;
}

export interface ScryfallPrices {
  usd?: string | null;
  usd_foil?: string | null;
  usd_etched?: string | null;
  eur?: string | null;
  eur_foil?: string | null;
  tix?: string | null;
}

export interface ScryfallCard {
  id: string;
  name: string;
  set: string;
  set_name: string;
  collector_number: string;
  rarity: Rarity;
  type_line?: string;
  mana_cost?: string;
  /** Converted mana cost / mana value. Scryfall returns 0 for lands and
   *  anything without a printed cost. Used by the sealed deck builder to
   *  bucket cards into mana-cost columns. */
  cmc?: number;
  colors?: string[];
  color_identity?: string[];
  image_uris?: ScryfallImageUris;
  card_faces?: ScryfallCardFace[];
  layout: string;
  scryfall_uri: string;
  promo?: boolean;
  variation?: boolean;
  full_art?: boolean;
  textless?: boolean;
  booster?: boolean;
  digital?: boolean;
  oversized?: boolean;
  prices?: ScryfallPrices;
  /* ---- Fields used by booster-config filters (set-specific recipes). ---- */
  /** e.g. ["showcase"], ["extendedart"], ["inverted"]. Scryfall populates
   *  this for treatment variants — borderless, showcase, extended-art,
   *  inverted, etalon-frame, etc. */
  frame_effects?: string[];
  /** "black" | "white" | "borderless" | "gold" | "silver". */
  border_color?: string;
  /** Promo variant tags, e.g. ["special-guests"], ["serialized"]. */
  promo_types?: string[];
  /** Mana symbols this card can produce — used by basic-land filters that
   *  want to differentiate dual lands from single-mana basics. */
  produced_mana?: string[];
  /** Two-letter language code: "en" (English), "ja" (Japanese), "de", "ru",
   *  "ko", etc. Source of truth for "this is the Japanese printing"
   *  regardless of how the set's collector numbers are arranged. */
  lang?: string;
  /** Available finishes on this printing — any of "nonfoil", "foil",
   *  "etched", "glossy". Lets a filter narrow to "only available in foil"
   *  separate from the slot's foil flag. */
  finishes?: string[];
}

interface ScryfallList<T> {
  object: "list";
  data: T[];
  has_more: boolean;
  next_page?: string;
  total_cards?: number;
}

/**
 * Scryfall JSON fetch with retry + backoff. Retries on 5xx (server hiccup),
 * 429 (rate limited), and network failures, up to `maxRetries` times with
 * exponential delay (200ms → 600ms → 1800ms). 4xx client errors throw
 * immediately because retrying won't help (bad query, missing set, etc.).
 *
 * Scryfall is reliable on average but has brief outages a few times a week;
 * pagination is the most-affected path because a single set can require 3–5
 * sequential GETs, and any one of them blipping kills the whole route. With
 * retries, transient failures recover automatically and the user never sees
 * the 503 page.
 */
async function sj<T>(
  url: string,
  revalidate = 60 * 60 * 24,
  maxRetries = 2,
): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: HEADERS,
        next: { revalidate },
      });
      if (res.ok) return (await res.json()) as T;

      // 4xx (except 429) — client error, don't retry.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new Error(`Scryfall ${res.status} on ${url}`);
      }

      lastErr = new Error(`Scryfall ${res.status} on ${url}`);
    } catch (e) {
      lastErr = e;
    }

    // Either a retriable HTTP status or a network failure — back off and
    // try again. Backoff stays tight (150ms, 450ms) so when Scryfall is
    // genuinely down for an extended window we fail fast and let
    // getSetCards' partial-tolerance recover rather than stalling the
    // page load for tens of seconds.
    if (attempt < maxRetries) {
      const delay = 150 * Math.pow(3, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Scryfall request failed: ${url}`);
}

/* ---------------- Sets ---------------- */

export async function getSets(): Promise<ScryfallSet[]> {
  const out: ScryfallSet[] = [];
  let url: string | undefined = `${BASE}/sets`;
  while (url) {
    const page: ScryfallList<ScryfallSet> = await sj<ScryfallList<ScryfallSet>>(url);
    out.push(...page.data);
    url = page.has_more ? page.next_page : undefined;
  }
  return out;
}

/** Minimum card count for a set to be considered drafrt-/sealed-/pack-
 *  worthy. Below this you get nonsense: foreign reprint products like
 *  FBB or RIN, tiny specialty boxes, and the like — opening a "pack"
 *  from them produces near-empty results since our slot machine can't
 *  meaningfully roll commons / uncommons / rares from a 20-card pool.
 *
 *  100 is the threshold below which a single 14-card booster would
 *  burn through ~14% of the available pool — duplicates dominate and
 *  the experience falls apart. Real Standard / supplemental sets clear
 *  this floor easily (typical: 250+ cards). */
const MIN_CARDS_FOR_PACK = 100;

/** Sets that have boosters, non-digital, with enough cards to feel
 *  like a real booster pool, and have actually been released
 *  (Scryfall lists upcoming sets with future release dates — we
 *  filter those out so "Recent" stays current). */
export async function getOpenableSets(): Promise<ScryfallSet[]> {
  const sets = await getSets();
  const allowed = new Set([
    "core",
    "expansion",
    "masters",
    "draft_innovation",
    "starter",
    "remastered",
  ]);
  const today = new Date().toISOString().slice(0, 10);
  return sets
    .filter(
      (s) =>
        !s.digital &&
        s.card_count >= MIN_CARDS_FOR_PACK &&
        allowed.has(s.set_type) &&
        (!s.released_at || s.released_at <= today),
    )
    .sort((a, b) =>
      (b.released_at ?? "").localeCompare(a.released_at ?? ""),
    );
}

export async function getSet(code: string): Promise<ScryfallSet | undefined> {
  const sets = await getSets();
  return sets.find((s) => s.code.toLowerCase() === code.toLowerCase());
}

/* ---------------- Cards by set ---------------- */

/**
 * Fetch every card in a set that's actually eligible for boosters.
 * Uses `unique=prints` to keep alt-art / language variants as distinct
 * entries (Scryfall would collapse them under `unique=cards`), and
 * `include_multilingual=true` so Japanese-alt-art cards in sets like
 * Strixhaven Mystical Archive (lang: "ja") appear in the pool. Without
 * the multilingual flag those alt-art Japanese cards never come back from
 * the API — and any recipe outcome filtered by `lang: "ja"` finds no
 * matches and silently falls through to its next outcome.
 */
export async function getSetCards(code: string): Promise<ScryfallCard[]> {
  const q = encodeURIComponent(`set:${code} game:paper`);
  const out: ScryfallCard[] = [];
  let url: string | undefined =
    `${BASE}/cards/search?q=${q}&unique=prints&order=set&include_extras=false&include_variations=false&include_multilingual=true`;
  while (url) {
    try {
      const page: ScryfallList<ScryfallCard> = await sj<ScryfallList<ScryfallCard>>(url, 60 * 60 * 24 * 7);
      out.push(...page.data);
      url = page.has_more ? page.next_page : undefined;
      // gentle pacing for multi-page fetches in dev
      if (url) await new Promise((r) => setTimeout(r, 80));
    } catch (e) {
      // sj already retried the page 3× — Scryfall is genuinely down for
      // this URL. Rather than killing the entire route, bail out with
      // whatever we've collected so far. The Next fetch cache will likely
      // get a successful response on the next request (we cache 7 days
      // at the fetch layer) so subsequent loads will be complete. The
      // engine's fallbacks tolerate incomplete pools.
      // eslint-disable-next-line no-console
      console.warn(
        `[scryfall] getSetCards(${code}): pagination failed at ${out.length} cards, returning partial result`,
        e,
      );
      break;
    }
  }
  // Tokens / emblems / schemes are fetched through getSetTokens when a
  // recipe references them, so they're filtered out here. Art series cards
  // (layout: "art_series") are NOT excluded any more — they live in their
  // own dedicated sets (e.g. ASOS for SOS) and Collector Booster recipes
  // explicitly reference those sets for the art-card slot. Excluding them
  // here would empty the ASOS pool and silently break those outcomes.
  return out.filter(
    (c) =>
      !c.digital &&
      !c.oversized &&
      c.layout !== "token" &&
      c.layout !== "double_faced_token" &&
      c.layout !== "emblem" &&
      c.layout !== "scheme",
  );
}

/* ---------------- Card image helpers ---------------- */

export function getCardImage(
  card: ScryfallCard,
  size: keyof ScryfallImageUris = "normal",
): string | undefined {
  if (card.image_uris?.[size]) return card.image_uris[size];
  const front = card.card_faces?.[0];
  return front?.image_uris?.[size];
}

export function getCardBackImage(card: ScryfallCard): string | undefined {
  const back = card.card_faces?.[1];
  return back?.image_uris?.normal;
}

/**
 * Fetch one representative card from a set and return its art_crop URL.
 * Used to back the home-page set tiles with each set's own iconic art.
 *
 * Strategy: pick the priciest mythic (or rare, or anything) from the set —
 * Scryfall's `order=usd direction=desc` returns the most-expensive first.
 * Returns null on any failure so the caller can fall back to icon-only.
 *
 * Aggressively cached (7 days) since per-set hero art rarely changes.
 */
export async function getSetSampleArt(code: string): Promise<string | null> {
  const set = code.toLowerCase();
  // Try priciest first. Some new sets have no priced cards yet (Scryfall
  // returns 404 for `order=usd` when no card has a USD value), so fall back
  // to rarity-ordered then unordered. Tokens / promos / digital are
  // excluded — they rarely carry a usable art_crop.
  const base = `set:${set} game:paper -is:digital -is:promo -t:token`;
  const attempts: string[] = [
    `${BASE}/cards/search?q=${encodeURIComponent(base)}&unique=cards&order=usd&dir=desc&page=1`,
    `${BASE}/cards/search?q=${encodeURIComponent(base)}&unique=cards&order=rarity&dir=desc&page=1`,
    `${BASE}/cards/search?q=${encodeURIComponent(base)}&unique=cards&page=1`,
  ];
  for (const url of attempts) {
    try {
      const page = await sj<ScryfallList<ScryfallCard>>(url, 60 * 60 * 24 * 7);
      for (const c of page.data) {
        const art =
          c.image_uris?.art_crop ??
          c.card_faces?.[0]?.image_uris?.art_crop;
        if (art) return art;
      }
    } catch {
      // 404 / transient — try the next strategy.
    }
  }
  return null;
}

/**
 * Fetch the token cards associated with a given expansion set. Scryfall puts
 * each set's tokens in a sibling set whose code is conventionally `t<code>`
 * (e.g. tokens for DSK live in TDSK). If that lookup returns nothing we
 * also try a broader query for tokens whose `set` field matches the original
 * code (some sets keep their tokens in-house).
 *
 * Returns [] gracefully on 404 / empty so the caller can always render.
 */
export async function getSetTokens(code: string): Promise<ScryfallCard[]> {
  const lower = code.toLowerCase();
  const candidates = [`t${lower}`, lower];
  for (const c of candidates) {
    const q = encodeURIComponent(`set:${c} type:token`);
    const url = `${BASE}/cards/search?q=${q}&unique=cards&include_extras=true&order=set`;
    try {
      const out: ScryfallCard[] = [];
      let next: string | undefined = url;
      while (next) {
        const page: ScryfallList<ScryfallCard> = await sj<ScryfallList<ScryfallCard>>(
          next,
          60 * 60 * 24 * 7,
        );
        out.push(...page.data);
        next = page.has_more ? page.next_page : undefined;
        if (next) await new Promise((r) => setTimeout(r, 80));
      }
      const filtered = out.filter(
        (t) =>
          !t.digital &&
          (t.layout === "token" || t.layout === "double_faced_token" || t.layout === "emblem"),
      );
      if (filtered.length) return filtered;
    } catch {
      // Try the next candidate.
    }
  }
  return [];
}

/** Best price to display for a card given its foil state. */
export function getDisplayPrice(
  card: ScryfallCard,
  foil = false,
): { value: number; label: string } | null {
  const p = card.prices;
  if (!p) return null;
  const raw = foil
    ? p.usd_foil ?? p.usd_etched ?? p.usd
    : p.usd ?? p.usd_foil ?? p.usd_etched;
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return { value: n, label: `$${n.toFixed(2)}` };
}
