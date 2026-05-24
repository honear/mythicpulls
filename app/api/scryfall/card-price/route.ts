/**
 * Edge route proxying Scryfall's per-card prices by Scryfall UUID.
 * Used by the BinderCardModal price hook (`lib/useScryfallCardPrice.ts`)
 * to show the EUR / Cardmarket price on the "Buy on Cardmarket" button
 * for cards in the binder — which only stores a trimmed
 * `CollectionEntry` and doesn't keep the original price block around.
 *
 * Why proxy vs hitting Scryfall directly:
 *   1. Caching — Next's `revalidate` plus the edge CDN keep us well
 *      under Scryfall's 10 req/sec rate limit even if a user opens
 *      lots of binder cards in quick succession.
 *   2. Trim — Scryfall returns a ~5 KB card object; we forward just
 *      the four price strings the modal cares about.
 *   3. Symmetry — same shape as `/api/manapool/single`, makes the
 *      `useScryfallCardPrice` hook a mechanical mirror of
 *      `useManaPoolSingle`.
 *
 * Public API, no auth on either side. Scryfall documents anonymous
 * access at https://scryfall.com/docs/api with a 50–100 ms/request
 * throttle recommendation; the edge cache here absorbs that for us.
 */

import { NextResponse, type NextRequest } from "next/server";

export const runtime = "edge";

const SCRYFALL_ID_RE =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

interface ScryfallCardResponse {
  prices?: {
    usd?: string | null;
    usd_foil?: string | null;
    usd_etched?: string | null;
    eur?: string | null;
    eur_foil?: string | null;
  };
  name?: string;
  /** Illustrator name. Surfaced on BinderCardModal as the "Art by"
   *  credit since binder entries don't store the original artist. */
  artist?: string;
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
    const upstream = await fetch(
      `https://api.scryfall.com/cards/${encodeURIComponent(scryfallId)}`,
      {
        headers: {
          "User-Agent": "ThreeTreeCity/0.1 (+https://github.com/honear)",
          Accept: "application/json",
        },
        // Match the Mana Pool proxy's 1-hour window. Scryfall's prices
        // update daily for most cards; an hour-stale figure is fine and
        // keeps us well below the recommended request rate.
        next: { revalidate: 3600 },
      },
    );

    if (upstream.status === 404) {
      return NextResponse.json(
        { found: false, scryfallId },
        { headers: { "Cache-Control": "public, s-maxage=300" } },
      );
    }
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `scryfall upstream ${upstream.status}` },
        { status: 502 },
      );
    }

    const body = (await upstream.json()) as ScryfallCardResponse;
    return NextResponse.json({
      found: true,
      scryfallId,
      name: body.name ?? null,
      artist: body.artist ?? null,
      // Pass strings through verbatim. Scryfall represents missing
      // prices as `null` rather than omitting the key; we preserve
      // that so the client can distinguish "didn't ship a value" from
      // "value is 0".
      usd: body.prices?.usd ?? null,
      usdFoil: body.prices?.usd_foil ?? null,
      usdEtched: body.prices?.usd_etched ?? null,
      eur: body.prices?.eur ?? null,
      eurFoil: body.prices?.eur_foil ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "fetch failed" },
      { status: 502 },
    );
  }
}
