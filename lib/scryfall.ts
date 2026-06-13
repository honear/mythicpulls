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
  /** Frame generation: "1993" | "1997" | "2003" | "2015" | "future".
   *  Used by retro-frame treatment filters. */
  frame?: string;
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
  /** Illustrator name (e.g. "Sara Winters", "Chris Seaman"). Surfaced
   *  in CardDetailModal as "Art by <artist>" credit. */
  artist?: string;
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
  /** When true, bypass Next's fetch cache entirely (cache: "no-store").
   *  Used as a retry mode when a previous cached response is suspected
   *  bad (e.g. an empty card pool). The default path still caches. */
  noStore = false,
): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: HEADERS,
        ...(noStore
          ? { cache: "no-store" as const }
          : { next: { revalidate } }),
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
 *  like a real booster pool, and are released OR within the 21-day
 *  preview lookahead (Scryfall lists far-future announced sets too —
 *  the horizon keeps those out so "Recent" stays meaningful while
 *  letting imminent releases like Marvel Super Heroes appear during
 *  preview season). */
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
  const horizonDate = new Date();
  horizonDate.setDate(horizonDate.getDate() + 21);
  const horizon = horizonDate.toISOString().slice(0, 10);
  return sets
    .filter(
      (s) =>
        !s.digital &&
        s.card_count >= MIN_CARDS_FOR_PACK &&
        allowed.has(s.set_type) &&
        // Release lookahead: sets within 21 days of release are shown in
        // the catalog during preview season (e.g. Marvel Super Heroes in
        // the run-up to 2026-06-26). By that point Scryfall has the bulk
        // of the set catalogued and the recipes' graceful fallbacks cover
        // any not-yet-indexed chase variants. The ≥100-card floor still
        // applies, so a just-announced set with a handful of previews
        // stays hidden.
        (!s.released_at || s.released_at <= horizon),
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
 * Read a pre-baked set's card pool from `data/set-cards/<code>.json.gz`
 * if the file exists. Written by scripts/build-set-cards.mjs and
 * updated periodically (monthly cadence is fine for an evergreen set,
 * more often when new sets release). The on-disk payload is already
 * trimmed + filtered, gzipped at level 9, so we just gunzip + JSON.parse
 * and return.
 *
 * Why gzip: raw JSON for ~177 sets clocked in at 371 MB, which blew
 * Vercel's 250 MB serverless function bundle limit. Gzip compresses
 * MTG card JSON ~80% (lots of repeated set codes, color symbols,
 * Scryfall URL prefixes), dropping the bundle to ~60-90 MB. Decompress
 * cost is ~5 ms per set on a Vercel function, lost in the noise next
 * to the eliminated Scryfall round-trips.
 *
 * Returns null when:
 *   • running in a browser (fs unavailable),
 *   • the file doesn't exist (brand-new set added between bake runs,
 *     or a set the bake script chose not to fetch),
 *   • read/decompress/parse fails (corrupted file — we shouldn't mask
 *     the live fetch's chance to succeed).
 *
 * The lazy dynamic import keeps `node:fs`/`node:zlib` out of client
 * bundles even though this file is also imported by client components
 * for the types.
 */
async function readPreBakedSetCards(code: string): Promise<ScryfallCard[] | null> {
  if (typeof window !== "undefined") return null;
  try {
    const [{ readFile }, { join }, { gunzipSync }] = await Promise.all([
      import("node:fs/promises"),
      import("node:path"),
      import("node:zlib"),
    ]);
    const filePath = join(process.cwd(), "data", "set-cards", `${code.toLowerCase()}.json.gz`);
    const gz = await readFile(filePath);
    const json = gunzipSync(gz).toString("utf8");
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    return parsed as ScryfallCard[];
  } catch {
    return null;
  }
}

/**
 * Fetch every card in a set that's actually eligible for boosters.
 * Uses `unique=prints` to keep alt-art / language variants as distinct
 * entries (Scryfall would collapse them under `unique=cards`), and
 * `include_multilingual=true` so Japanese-alt-art cards in sets like
 * Strixhaven Mystical Archive (lang: "ja") appear in the pool. Without
 * the multilingual flag those alt-art Japanese cards never come back from
 * the API — and any recipe outcome filtered by `lang: "ja"` finds no
 * matches and silently falls through to its next outcome.
 *
 * The disk-first read at the top is the steady-state path — pre-baked
 * by scripts/build-set-cards.mjs. The live Scryfall pagination below
 * stays in place for the long tail (brand-new sets the bake hasn't
 * caught yet, or sets the bake script chose to skip).
 */
export async function getSetCards(code: string): Promise<ScryfallCard[]> {
  const preBaked = await readPreBakedSetCards(code);
  if (preBaked && preBaked.length > 0) return preBaked;

  // First try with the standard 7-day fetch cache. If that returns an
  // empty pool we run the same query AGAIN with cache: "no-store" — that
  // covers the failure mode where a transient Scryfall blip cached a
  // 200 with `data: []` (which then served as the "result" for 7 days
  // and produced the dreaded "0 cards in pack" UI). The no-store retry
  // gives Scryfall a fresh chance; if it ALSO returns empty we accept
  // it as the truth (genuinely new set, no cards indexed yet, etc.).
  const first = await fetchAllPages(code, false);
  if (first.length > 0) return filterPool(first);
  // eslint-disable-next-line no-console
  console.warn(
    `[scryfall] getSetCards(${code}): cached/initial fetch returned 0 cards — retrying with cache: "no-store"`,
  );
  const retry = await fetchAllPages(code, true);
  return filterPool(retry);
}

/** Helper extracted so the empty-pool retry can re-run the exact same
 *  pagination loop with a different cache mode. */
async function fetchAllPages(
  code: string,
  noStore: boolean,
): Promise<ScryfallCard[]> {
  const q = encodeURIComponent(`set:${code} game:paper`);
  const out: ScryfallCard[] = [];
  let url: string | undefined =
    `${BASE}/cards/search?q=${q}&unique=prints&order=set&include_extras=false&include_variations=false&include_multilingual=true`;
  while (url) {
    try {
      const page: ScryfallList<ScryfallCard> = await sj<ScryfallList<ScryfallCard>>(
        url,
        60 * 60 * 24 * 7,
        2,
        noStore,
      );
      out.push(...page.data);
      url = page.has_more ? page.next_page : undefined;
      // gentle pacing for multi-page fetches in dev
      if (url) await new Promise((r) => setTimeout(r, 80));
    } catch (e) {
      // sj already retried the page 3× — Scryfall is genuinely down for
      // this URL. Rather than killing the entire route, bail out with
      // whatever we've collected so far. The engine's fallbacks tolerate
      // incomplete pools, and the outer empty-pool retry will kick in
      // when out=== [] so we don't bake a transient outage into cache.
      // eslint-disable-next-line no-console
      console.warn(
        `[scryfall] getSetCards(${code}): pagination failed at ${out.length} cards, returning partial result`,
        e,
      );
      break;
    }
  }
  return out;
}

/** Tokens / emblems / schemes are fetched through getSetTokens when a
 *  recipe references them, so they're filtered out here. Art series
 *  cards (layout: "art_series") are NOT excluded any more — they live
 *  in their own dedicated sets (e.g. ASOS for SOS) and Collector
 *  Booster recipes explicitly reference those sets for the art-card
 *  slot. Excluding them here would empty the ASOS pool and silently
 *  break those outcomes. */
function filterPool(cards: ScryfallCard[]): ScryfallCard[] {
  return cards.filter(
    (c) =>
      !c.digital &&
      !c.oversized &&
      c.layout !== "token" &&
      c.layout !== "double_faced_token" &&
      c.layout !== "emblem" &&
      c.layout !== "scheme",
  );
}

/**
 * Strip ScryfallCard down to just the fields the client actually reads
 * before serializing it into a server-component prop. The Scryfall API
 * returns ~40 fields per card (oracle_text, rulings_uri, multiverse_ids,
 * tcgplayer_id, purchase_uris, artist, flavor_text, …) that the TS
 * interface declares away but which still ride along in the parsed
 * JSON object — and therefore in the hydration payload. Calling this
 * at the route boundary trims a typical set's pool from ~450–800 KB to
 * ~150–250 KB (3–4× smaller First Interactive payload).
 *
 * Returns a value that still type-conforms to ScryfallCard so no
 * consumer needs to change. Adding a new used field? Add it to the
 * shape below — easier to add a known-needed field than to debug a
 * mystery missing one downstream.
 */
export function trimCardForClient(c: ScryfallCard): ScryfallCard {
  return {
    id: c.id,
    name: c.name,
    set: c.set,
    set_name: c.set_name,
    collector_number: c.collector_number,
    rarity: c.rarity,
    type_line: c.type_line,
    mana_cost: c.mana_cost,
    cmc: c.cmc,
    colors: c.colors,
    color_identity: c.color_identity,
    // Image URIs — shallow-clone so the original ScryfallImageUris
    // object (which carries unused `small`/`png`/`border_crop`) stays
    // upstream. We only need normal, large, and art_crop client-side.
    image_uris: c.image_uris
      ? {
          normal: c.image_uris.normal,
          large: c.image_uris.large,
          art_crop: c.image_uris.art_crop,
        }
      : undefined,
    card_faces: c.card_faces?.map((f) => ({
      name: f.name,
      mana_cost: f.mana_cost,
      type_line: f.type_line,
      image_uris: f.image_uris
        ? {
            normal: f.image_uris.normal,
            large: f.image_uris.large,
            art_crop: f.image_uris.art_crop,
          }
        : undefined,
    })),
    layout: c.layout,
    // Used by the "View on Scryfall" link in CardDetailModal — keep.
    scryfall_uri: c.scryfall_uri,
    // CardDetailModal + Cardmarket button read `usd`, `usd_foil`, `eur`,
    // `eur_foil`. `getDisplayPrice` falls back to `usd_etched` for
    // etched-foil cards (rare but worth preserving so etched prints
    // don't silently drop their price). Drop only `tix` (MTGO, unused).
    prices: c.prices
      ? {
          usd: c.prices.usd,
          usd_foil: c.prices.usd_foil,
          usd_etched: c.prices.usd_etched,
          eur: c.prices.eur,
          eur_foil: c.prices.eur_foil,
        }
      : undefined,
    // Artist name — used by CardDetailModal to credit the illustrator
    // in the info panel. Cheap to keep (one string per card) and lets
    // the same modal honor the art on every card it shows.
    artist: c.artist,
    // Filter-relevant fields. All five are referenced by booster recipe
    // filters and the basic-land logic; dropping any breaks specific
    // set pack rolls (showcase frame filters, Japanese-alt-art filters,
    // foil-only finishes, dual-mana basics, etc.).
    frame_effects: c.frame_effects,
    frame: c.frame,
    full_art: c.full_art,
    // Variation prints (alternate printings of in-set cards: DSK Lurking
    // Evil, DMU etched Legends Retold, J25 anime). regular_print excludes
    // them implicitly; variation_print targets them. Keep in sync with
    // trimCard in scripts/build-set-cards.mjs.
    variation: c.variation,
    border_color: c.border_color,
    promo_types: c.promo_types,
    produced_mana: c.produced_mana,
    lang: c.lang,
    finishes: c.finishes,
    // `digital`/`oversized` are post-fetch filters in filterPool above —
    // by the time we hit the trim, they're already false for every
    // card in the pool. Keep them in the return shape so the TS type
    // stays satisfied even though we don't repaint them.
    digital: false,
    oversized: false,
    // `booster` is referenced by some recipes to filter to
    // "booster-eligible" cards (e.g. exclude planeswalker deck
    // exclusives). Keep.
    booster: c.booster,
  };
}

/** Trim every card in a multi-set CardPool-shaped object. Convenience
 *  wrapper for the 3 routes that ship a pool to the client. */
export function trimCardPool(
  pool: Record<string, ScryfallCard[]>,
): Record<string, ScryfallCard[]> {
  const out: Record<string, ScryfallCard[]> = {};
  for (const setCode of Object.keys(pool)) {
    out[setCode] = pool[setCode].map(trimCardForClient);
  }
  return out;
}

/**
 * Drop non-English printings the client engine can never select. The
 * pools come back from Scryfall with include_multilingual=true (needed
 * so Japanese-alt-art outcomes have candidates), but the engine's
 * English-by-default pass makes every other-language print unreachable
 * UNLESS some outcome's filter mentions that language. For a typical set
 * page this is 60-75% of the serialized pool — multi-megabyte HTML on
 * mobile for cards that cannot ever be rolled.
 *
 * `extraLangs` comes from collectRecipeLanguages(recipes, filters) —
 * usually empty (ship English only) or {"ja"} for sets with Japanese
 * alt-art outcomes (SOS, DSK, ECL, …).
 *
 * Safety valve: if trimming would empty a set's list entirely (a pool
 * that only exists in non-English printings — not known to happen, but
 * cheap to guard), the untrimmed list is kept so the engine's own
 * fallbacks still have candidates.
 */
export function trimPoolLanguages(
  pool: Record<string, ScryfallCard[]>,
  extraLangs: ReadonlySet<string>,
): Record<string, ScryfallCard[]> {
  const out: Record<string, ScryfallCard[]> = {};
  for (const setCode of Object.keys(pool)) {
    const cards = pool[setCode];
    const kept = cards.filter(
      (c) => !c.lang || c.lang.toLowerCase() === "en" || extraLangs.has(c.lang.toLowerCase()),
    );
    out[setCode] = kept.length > 0 ? kept : cards;
  }
  return out;
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
  // Pre-baked tokens live at data/set-cards/t<code>.json — same on-disk
  // location as regular set pools but with the t-prefix. Check that first
  // before paginating Scryfall, same disk-first strategy as getSetCards.
  const preBakedTokens = await readPreBakedSetCards(`t${lower}`);
  if (preBakedTokens && preBakedTokens.length > 0) return preBakedTokens;
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
