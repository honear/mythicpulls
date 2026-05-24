/**
 * Cardmarket deep links.
 *
 * Cardmarket has a real public API but it requires OAuth (paid tier for
 * most endpoints), so we don't pull prices from them directly. The EUR
 * figure we show is Scryfall's `prices.eur` field, which Scryfall itself
 * sources from Cardmarket — i.e. it's the exact same number you'd see
 * on the Cardmarket product page.
 *
 * Deep-link URL pattern: their search-by-name endpoint reliably lands
 * on a product list filtered to the requested card across every set,
 * which is the same UX as the existing Card Kingdom button. We could
 * also build `/en/Magic/Cards/<slug>` direct-product URLs but the slug
 * rules (apostrophes, commas, ' / ' separators on split cards) are
 * undocumented; the search URL is the safe bet.
 *
 * Affiliate code is wired the same way as Mana Pool — set
 * `NEXT_PUBLIC_CARDMARKET_REF` in `.env.local` to opt in. The Cardmarket
 * Partner Program uses `?utm_source=` for cookie tracking; we append
 * that key when the env var is set, otherwise links go out un-tagged.
 */

/** Affiliate / partner code appended to all Cardmarket deep links when
 *  set. Configure via `NEXT_PUBLIC_CARDMARKET_REF` in `.env.local`. */
export const CARDMARKET_REF = process.env.NEXT_PUBLIC_CARDMARKET_REF ?? "";

/** Append `?utm_source=<CARDMARKET_REF>` to a URL when the partner code
 *  is set, otherwise return the URL unchanged. */
export function withCardmarketRef(url: string): string {
  if (!CARDMARKET_REF) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}utm_source=${encodeURIComponent(CARDMARKET_REF)}`;
}

/**
 * Build a Cardmarket search URL for a given card name. Lands on the
 * Magic singles search results page; the user picks the printing they
 * want. Matches the Card Kingdom pattern.
 *
 * `exactMatch=true` narrows results to exact name matches, which avoids
 * partial-string noise for short names like "Bolt" or "Path".
 */
export function getCardmarketCardUrl(cardName: string): string {
  const base = `https://www.cardmarket.com/en/Magic/Products/Search?searchString=${encodeURIComponent(
    cardName,
  )}&exactMatch=true`;
  return withCardmarketRef(base);
}
