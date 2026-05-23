/**
 * Image preloader used to keep card reveals from being spoiled by
 * lazy-loaded fronts: when a pack rips, every card's front-face JPEG is
 * kicked off via `new Image().src = url` so the browser starts the
 * network requests immediately. The eventual `<img>` element rendered
 * by MagicCard then hits the in-memory cache and paints instantly.
 *
 * Resolves once every URL has either loaded or errored, or `maxWaitMs`
 * has elapsed — whichever comes first. The max wait is a safety net so
 * a single slow Scryfall response can't hang the rip animation
 * indefinitely; in practice all images finish well inside the 1300ms
 * rip choreography.
 */
export function preloadImages(
  urls: ReadonlyArray<string | undefined>,
  maxWaitMs = 4000,
): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const real = urls.filter((u): u is string => !!u);
  if (real.length === 0) return Promise.resolve();

  const all = Promise.all(
    real.map(
      (url) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          // Errors resolve too — we never want a missing image to block
          // the reveal. The downstream <img> will fall back to alt text
          // or stay blank, which is fine.
          img.onerror = () => resolve();
          img.src = url;
        }),
    ),
  ).then(() => {});

  const timeout = new Promise<void>((resolve) =>
    window.setTimeout(resolve, maxWaitMs),
  );

  return Promise.race([all, timeout]);
}
