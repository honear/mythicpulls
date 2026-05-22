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
  "User-Agent": "MythicPulls/0.1 (https://github.com/local; pack-opening sim)",
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
}

interface ScryfallList<T> {
  object: "list";
  data: T[];
  has_more: boolean;
  next_page?: string;
  total_cards?: number;
}

async function sj<T>(url: string, revalidate = 60 * 60 * 24): Promise<T> {
  const res = await fetch(url, {
    headers: HEADERS,
    next: { revalidate },
  });
  if (!res.ok) {
    throw new Error(`Scryfall ${res.status} on ${url}`);
  }
  return res.json() as Promise<T>;
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

/** Sets that have boosters, non-digital, with cards available. */
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
  return sets
    .filter(
      (s) =>
        !s.digital &&
        s.card_count > 0 &&
        allowed.has(s.set_type),
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
 * Uses `unique=cards` to dedupe printings and `booster:true` to filter
 * promo/variant noise.
 */
export async function getSetCards(code: string): Promise<ScryfallCard[]> {
  const q = encodeURIComponent(`set:${code} game:paper`);
  const out: ScryfallCard[] = [];
  let url: string | undefined =
    `${BASE}/cards/search?q=${q}&unique=cards&order=set&include_extras=false&include_variations=false`;
  while (url) {
    const page: ScryfallList<ScryfallCard> = await sj<ScryfallList<ScryfallCard>>(url, 60 * 60 * 24 * 7);
    out.push(...page.data);
    url = page.has_more ? page.next_page : undefined;
    // gentle pacing for multi-page fetches in dev
    if (url) await new Promise((r) => setTimeout(r, 80));
  }
  return out.filter(
    (c) =>
      !c.digital &&
      !c.oversized &&
      c.layout !== "art_series" &&
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
  const q = encodeURIComponent(`set:${code.toLowerCase()} game:paper -is:digital`);
  const url =
    `${BASE}/cards/search?q=${q}&unique=cards&order=usd&dir=desc&page=1`;
  try {
    const page = await sj<ScryfallList<ScryfallCard>>(url, 60 * 60 * 24 * 7);
    for (const c of page.data) {
      const art =
        c.image_uris?.art_crop ??
        c.card_faces?.[0]?.image_uris?.art_crop;
      if (art) return art;
    }
  } catch {
    // 404 (set has 0 cards) or transient — fall through.
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
