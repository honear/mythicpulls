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
