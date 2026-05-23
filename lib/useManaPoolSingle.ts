"use client";

/**
 * Client hook for fetching a single card's live Mana Pool price.
 *
 * Backed by the edge route at `app/api/manapool/single/route.ts`, which
 * handles upstream caching + CORS. The hook adds an in-memory cache on
 * top so the same (scryfall_id, foil) combo never refetches within a
 * session — useful when the user opens, closes, and reopens the same
 * card popup (very common in the binder).
 *
 * Returns a "best price" figure the UI shows on the Buy button:
 *   marketCents → lowCentsNm → lowCents → null
 *
 * Market is the volume-weighted/recent-sales price (most representative
 * of what the user would actually pay if they bought one today). When
 * there are no recent sales, fall back to the lowest NM ask, then the
 * lowest any-condition ask. Returns null if Mana Pool doesn't carry
 * the card — the modal hides the inline price in that case but keeps
 * the Buy button (the URL still 301s to the product page; the user
 * gets a "we don't stock this" Mana Pool screen they can read).
 */

import { useEffect, useState } from "react";

export interface ManaPoolSinglePrice {
  /** Headline price for the requested finish in USD — what the modal
   *  pins to the Buy button. Resolution: market > NM low > low. */
  bestUsd: number | null;
  /** Volume-weighted market price (or null when no recent sales). */
  marketUsd: number | null;
  /** Marketplace floor (cheapest current ask, any condition). */
  lowUsd: number | null;
  /** Lowest NM ask, in USD. */
  lowNmUsd: number | null;
  /** Direct product page URL on Mana Pool (without affiliate ref). */
  url: string | null;
  /** In-stock listings across all sellers. */
  available: number;
}

interface UpstreamHit {
  found: true;
  scryfallId: string;
  name: string;
  url: string;
  available: number;
  lowCents: number | null;
  lowCentsNm: number | null;
  marketCents: number | null;
  lowCentsFoil: number | null;
  lowCentsNmFoil: number | null;
  marketCentsFoil: number | null;
}

interface UpstreamMiss {
  found: false;
  scryfallId: string;
}

type UpstreamResponse = UpstreamHit | UpstreamMiss;

// Session-scoped cache keyed by `${scryfallId}:${foil}` — keeps repeat
// modal opens snappy. Cleared on full page reload, which is fine: the
// edge route's own revalidate window (1h) keeps prices reasonably
// fresh across sessions anyway.
const cache = new Map<string, ManaPoolSinglePrice | null>();

function cents(n: number | null | undefined): number | null {
  return typeof n === "number" ? n / 100 : null;
}

function pickBest(values: Array<number | null>): number | null {
  for (const v of values) {
    if (typeof v === "number") return v;
  }
  return null;
}

function toPrice(body: UpstreamHit, foil: boolean): ManaPoolSinglePrice {
  if (foil) {
    const market = cents(body.marketCentsFoil);
    const lowNm = cents(body.lowCentsNmFoil);
    const low = cents(body.lowCentsFoil);
    return {
      bestUsd: pickBest([market, lowNm, low]),
      marketUsd: market,
      lowUsd: low,
      lowNmUsd: lowNm,
      url: body.url,
      available: body.available,
    };
  }
  const market = cents(body.marketCents);
  const lowNm = cents(body.lowCentsNm);
  const low = cents(body.lowCents);
  return {
    bestUsd: pickBest([market, lowNm, low]),
    marketUsd: market,
    lowUsd: low,
    lowNmUsd: lowNm,
    url: body.url,
    available: body.available,
  };
}

export function useManaPoolSingle(
  scryfallId: string | undefined,
  foil: boolean | undefined,
): { data: ManaPoolSinglePrice | null; loading: boolean } {
  const key = scryfallId ? `${scryfallId}:${foil ? "1" : "0"}` : null;
  // Seed from cache so re-opens skip the loading flash entirely.
  const [data, setData] = useState<ManaPoolSinglePrice | null>(() =>
    key ? cache.get(key) ?? null : null,
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!key || !scryfallId) {
      setData(null);
      return;
    }
    // Cached — pull synchronously, no fetch.
    if (cache.has(key)) {
      setData(cache.get(key) ?? null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetch(`/api/manapool/single?scryfall_id=${encodeURIComponent(scryfallId)}`)
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
        // Network/route error: don't cache. Lets a retry succeed if
        // the user re-opens the modal after coming back online.
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
