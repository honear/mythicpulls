/**
 * Edge route proxying Mana Pool's `/api/v1/products/singles` lookup by
 * Scryfall ID. Used by the CardDetailModal / BinderCardModal price hook
 * (`lib/useManaPoolSingle.ts`) so the buy buttons can show "you'd pay
 * $X.XX" inline before the user clicks through.
 *
 * Why proxy instead of fetching Mana Pool from the browser directly:
 *   1. CORS — Mana Pool's API doesn't advertise itself for browser
 *      origins; routing through our own host sidesteps that entirely.
 *   2. Caching — `next: { revalidate: 3600 }` lets us cache each
 *      response for an hour, sparing Mana Pool from per-popup hits and
 *      giving repeat opens an instant price.
 *   3. Trim — Mana Pool's response includes ~20 variants per card
 *      (every condition × finish); we only need the headline figures.
 *      Trimming on the server keeps the client payload tiny.
 *
 * Public route, no auth on either side — Mana Pool's endpoint is
 * documented as anonymously accessible (see manapool.com/api/docs/v1).
 */

import { NextResponse, type NextRequest } from "next/server";

export const runtime = "edge";

// Scryfall card IDs are RFC4122 v4 UUIDs. Validate the shape before
// forwarding to keep arbitrary query strings (and obvious mistakes)
// out of the upstream URL.
const SCRYFALL_ID_RE =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

const UPSTREAM = "https://manapool.com/api/v1/products/singles";

interface UpstreamEntry {
  scryfall_id: string;
  name: string;
  url: string;
  available_quantity: number;
  /** Lowest ask any condition, in cents. */
  price_cents: number | null;
  /** Lowest NM ask, in cents. */
  price_cents_nm: number | null;
  /** Volume-weighted/recent-sales market price, in cents. */
  price_market: number | null;
  /** Foil equivalents. */
  price_cents_foil: number | null;
  price_cents_nm_foil: number | null;
  price_market_foil: number | null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const scryfallId = searchParams.get("scryfall_id");

  if (!scryfallId) {
    return NextResponse.json(
      { error: "scryfall_id query parameter is required" },
      { status: 400 },
    );
  }
  if (!SCRYFALL_ID_RE.test(scryfallId)) {
    return NextResponse.json(
      { error: "scryfall_id must be a UUID" },
      { status: 400 },
    );
  }

  try {
    const upstreamUrl = `${UPSTREAM}?scryfall_ids=${encodeURIComponent(
      scryfallId,
    )}`;
    const upstream = await fetch(upstreamUrl, {
      headers: {
        "User-Agent": "ThreeTreeCity/0.1 (+https://github.com/honear)",
        Accept: "application/json",
      },
      // Cache for an hour. Mana Pool's prices update throughout the day
      // but individual cards rarely move enough to justify hitting them
      // every modal open.
      next: { revalidate: 3600 },
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `manapool upstream ${upstream.status}` },
        { status: 502 },
      );
    }

    const body = (await upstream.json()) as { data?: UpstreamEntry[] };
    // The endpoint can technically return multiple rows when a Scryfall
    // ID maps to several Mana Pool products (e.g. double-faced cards),
    // but in practice singles lookups return at most one. The dedicated
    // 409 ambiguity response from upstream is the explicit signal for
    // multi-row collisions; treat anything else as "first hit wins".
    const entry = body.data?.[0];

    if (!entry) {
      // Trim payload — explicit "not found" so the client doesn't have
      // to disambiguate against `null` or `{}`.
      return NextResponse.json(
        {
          found: false,
          scryfallId,
        },
        {
          // Short cache for misses so we don't bombard upstream on
          // every modal open for the same not-listed card, but
          // shorter than hit cache so a newly listed card surfaces
          // within an hour.
          headers: { "Cache-Control": "public, s-maxage=300" },
        },
      );
    }

    return NextResponse.json({
      found: true,
      scryfallId: entry.scryfall_id,
      name: entry.name,
      url: entry.url,
      available: entry.available_quantity,
      // Non-foil ladder: market > NM low > any-condition low.
      // The client picks one based on the modal's `foil` prop.
      lowCents: entry.price_cents,
      lowCentsNm: entry.price_cents_nm,
      marketCents: entry.price_market,
      // Foil ladder, same shape.
      lowCentsFoil: entry.price_cents_foil,
      lowCentsNmFoil: entry.price_cents_nm_foil,
      marketCentsFoil: entry.price_market_foil,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "fetch failed" },
      { status: 502 },
    );
  }
}
