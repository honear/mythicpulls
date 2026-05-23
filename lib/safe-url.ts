/**
 * Defensive helpers for handling URLs and route inputs that ultimately come
 * from an external source (Scryfall, route params, etc.) and end up either
 * as an anchor `href` or as a piece of a fetch URL.
 *
 * None of these mitigate a real attack against this codebase as written —
 * Scryfall is trusted and the route params are only used in URL-encoded
 * Scryfall queries. They are belt-and-suspenders fixes against:
 *
 *   - A hypothetical Scryfall compromise returning `javascript:` URIs.
 *   - A future refactor that forgets to encodeURIComponent route params.
 *   - A future feature that accepts something other than a Scryfall code.
 */

/**
 * Returns `url` only if it parses as an http(s) URL whose origin is in the
 * trusted-origin list. Anything else (javascript:, data:, blob:, file:,
 * malformed) returns `null` so the caller can hide the link entirely
 * instead of rendering a dangerous one.
 *
 * The allowed hosts here are intentionally the hosts we link to from
 * within the app. Add new ones explicitly — better to surface a missing
 * entry than to silently widen the trust boundary.
 */
const ALLOWED_EXTERNAL_HOSTS: ReadonlySet<string> = new Set([
  "scryfall.com",
  "www.scryfall.com",
  "cards.scryfall.io",
  "backs.scryfall.io",
  "api.scryfall.com",
  "cardkingdom.com",
  "www.cardkingdom.com",
  // Mana Pool sealed-product + singles deep links (see lib/manapool.ts).
  // Without these the safe-url guard silently returns null for every
  // Mana Pool href, hiding the "Buy on Mana Pool" buttons.
  "manapool.com",
  "www.manapool.com",
]);

export function safeExternalUrl(url: string | undefined | null): string | null {
  if (!url || typeof url !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (!ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  return parsed.toString();
}

/**
 * Returns a normalized Scryfall-style set code (alphanumeric, lowercase)
 * if `raw` looks like one, otherwise null. Set codes are 2–6 ASCII letters
 * or digits in practice (e.g. "dsk", "fdn", "mh3", "neo", "p25"). We
 * permit hyphens (some promo sets like "ptg-promo") and cap length at 16
 * to give a generous-but-not-unbounded ceiling.
 *
 * Anything else (path traversal, query characters, unicode, etc.) is
 * rejected. Callers should treat null as "this isn't a valid set code"
 * and respond with notFound() — exactly the same shape as Scryfall
 * returning a 404, which the page already handles.
 */
export function validateSetCode(raw: string | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  if (raw.length > 16) return null;
  if (!/^[a-z0-9-]+$/i.test(raw)) return null;
  return raw.toLowerCase();
}
