/**
 * Run an async `fn` over every item in `items`, but with no more than
 * `concurrency` in flight at a time. Results come back in the same
 * order as the input. Resolves once every item has completed.
 *
 * Used by the set-picker pages to fetch per-set art crops from
 * Scryfall without blasting them with 200+ parallel requests on a
 * cold first SSR — Scryfall's soft rate limit is ~10 req/sec, and
 * `getSetSampleArt` itself can fire up to 3 sub-requests per set
 * (priciest → rarity-sorted → unordered fallback chain). Keeping
 * concurrency at ~6 stays well under the limit even in the worst
 * case while still rendering the catalog quickly.
 */
export async function mapWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    worker,
  );
  await Promise.all(workers);
  return out;
}
