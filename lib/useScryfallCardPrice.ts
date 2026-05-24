"use client";

/**
 * Client hook for fetching a single card's prices from Scryfall.
 *
 * Backed by the edge route at `app/api/scryfall/card-price/route.ts`,
 * which handles upstream caching + the (mostly-irrelevant) CORS story.
 * Used by `BinderCardModal` to render the EUR figure on the "Buy on
 * Cardmarket" button — binder entries store a trimmed
 * `CollectionEntry` without the original Scryfall price block, so we
 * have to re-look it up at modal open time.
 *
 * In-memory cache keyed by `${scryfallId}:${foil}` keeps repeat opens
 * snappy, matching the `useManaPoolSingle` pattern.
 */

import { useEffect, useState } from "react";

export interface ScryfallCardPrice {
  /** TCGplayer market price in USD (foil-adjusted when applicable). */
  usd: number | null;
  /** Cardmarket EUR price (foil-adjusted when applicable). Source of
   *  the chip on the "Buy on Cardmarket" button. */
  eur: number | null;
  /** Illustrator name. Used by BinderCardModal to render an "Art by"
   *  credit on cards that came from the binder, where we don't have
   *  the original artist stored on the CollectionEntry. */
  artist: string | null;
}

interface UpstreamHit {
  found: true;
  scryfallId: string;
  name: string | null;
  artist: string | null;
  usd: string | null;
  usdFoil: string | null;
  usdEtched: string | null;
  eur: string | null;
  eurFoil: string | null;
}

interface UpstreamMiss {
  found: false;
  scryfallId: string;
}

type UpstreamResponse = UpstreamHit | UpstreamMiss;

const cache = new Map<string, ScryfallCardPrice | null>();

/** Parse Scryfall's numeric-string price into a number, or null when
 *  the upstream gave us null/undefined/empty. */
function num(s: string | null | undefined): number | null {
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toPrice(body: UpstreamHit, foil: boolean): ScryfallCardPrice {
  if (foil) {
    return {
      // Foil USD: prefer usd_foil, fall back to usd_etched (for etched
      // foils which Scryfall splits onto a separate field), then plain
      // usd as a last resort.
      usd: num(body.usdFoil) ?? num(body.usdEtched) ?? num(body.usd),
      eur: num(body.eurFoil) ?? num(body.eur),
      artist: body.artist,
    };
  }
  return {
    usd: num(body.usd),
    eur: num(body.eur),
    artist: body.artist,
  };
}

export function useScryfallCardPrice(
  scryfallId: string | undefined,
  foil: boolean | undefined,
): { data: ScryfallCardPrice | null; loading: boolean } {
  const key = scryfallId ? `${scryfallId}:${foil ? "1" : "0"}` : null;
  const [data, setData] = useState<ScryfallCardPrice | null>(() =>
    key ? cache.get(key) ?? null : null,
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!key || !scryfallId) {
      setData(null);
      return;
    }
    if (cache.has(key)) {
      setData(cache.get(key) ?? null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetch(`/api/scryfall/card-price?scryfall_id=${encodeURIComponent(scryfallId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as UpstreamResponse;
      })
      .then((body) => {
        if (cancelled) return;
        if (!body || !body.found) {
          cache.set(key, null);
          setData(null);
          return;
        }
        const price = toPrice(body, !!foil);
        cache.set(key, price);
        setData(price);
      })
      .catch(() => {
        // Don't cache network errors — lets a future retry succeed.
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [key, scryfallId, foil]);

  return { data, loading };
}
