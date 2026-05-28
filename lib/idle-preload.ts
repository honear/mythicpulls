/**
 * Idle background image pre-warmer for card pools.
 *
 * The active `preloadImages` helper (lib/preload.ts) blocks on a small
 * set of URLs and races them against a 4-second timeout, used during
 * the rip animation and at sealed/draft phase transitions. It works
 * well for the immediate next reveal but doesn't help with:
 *
 *   - The first-pack-on-a-cold-browser jitter (HTTP cache empty,
 *     14 images requested in parallel, network bottleneck visible).
 *   - Draft pack 2/3 transitions where each round triggers a fresh
 *     batch of image fetches.
 *   - The "Open next pack" MoneyStrip button — the next pack's images
 *     race the 1300ms rip animation rather than starting earlier.
 *
 * This module fixes those by walking the entire card pool in the
 * background, populating the browser's HTTP cache while the user is
 * picking sets / staring at the fan / reading the intro copy. By the
 * time they actually open a pack, every relevant image is already in
 * cache and `<img>` paints instantly.
 *
 * Behaviour:
 *   - Uses `requestIdleCallback` so the warm-up never competes with
 *     the user's input or animation frames. Falls back to a slow
 *     `setTimeout` chain in browsers without it (mostly Safari).
 *   - Chunks the queue (5 images per idle tick) so a 300-card pool
 *     doesn't saturate the network all at once.
 *   - Gated on `navigator.connection.effectiveType`: skipped on
 *     `slow-2g` / `2g` / `3g` so we don't burn cellular data, and on
 *     `saveData: true` so we honour explicit data-saver preferences.
 *   - Cancellable. The hook returns a stop function; callers cancel
 *     on unmount or when the user starts opening packs (don't compete
 *     with active preload).
 *
 * Bandwidth note: a 300-card set at the "normal" JPEG variant (488
 * wide) averages ~80 KB → ~24 MB warmed in the background. Acceptable
 * on wifi; we skip the warm-up entirely on metered connections.
 */

type IdleHandle = ReturnType<typeof setTimeout> | number;

interface IdleDeadline {
  didTimeout: boolean;
  timeRemaining: () => number;
}

interface IdleCallbackOptions {
  timeout?: number;
}

// Narrow the requestIdleCallback typing (not in lib.dom by default in
// every TS lib config) and provide a shim where the API doesn't exist.
function scheduleIdle(
  cb: (deadline: IdleDeadline) => void,
  options?: IdleCallbackOptions,
): IdleHandle {
  if (typeof window === "undefined") return 0;
  type Win = Window & {
    requestIdleCallback?: (
      cb: (deadline: IdleDeadline) => void,
      opts?: IdleCallbackOptions,
    ) => number;
  };
  const w = window as Win;
  if (typeof w.requestIdleCallback === "function") {
    return w.requestIdleCallback(cb, options);
  }
  // Fallback: ~16 ms slot, just enough to look like an idle frame.
  return window.setTimeout(
    () => cb({ didTimeout: false, timeRemaining: () => 8 }),
    16,
  );
}

function cancelIdle(handle: IdleHandle) {
  if (typeof window === "undefined") return;
  type Win = Window & { cancelIdleCallback?: (h: number) => void };
  const w = window as Win;
  if (typeof handle === "number" && typeof w.cancelIdleCallback === "function") {
    w.cancelIdleCallback(handle);
    return;
  }
  // setTimeout handle
  window.clearTimeout(handle as ReturnType<typeof setTimeout>);
}

/** Detects metered / slow connections so we can skip the warm-up.
 *  navigator.connection is a draft API only Chromium ships fully; the
 *  Safari-style absence is treated as "fast enough, go ahead". */
function isMeteredConnection(): boolean {
  if (typeof navigator === "undefined") return false;
  type Conn = {
    effectiveType?: "slow-2g" | "2g" | "3g" | "4g";
    saveData?: boolean;
  };
  const conn = (navigator as Navigator & { connection?: Conn }).connection;
  if (!conn) return false;
  if (conn.saveData) return true;
  if (conn.effectiveType && conn.effectiveType !== "4g") return true;
  return false;
}

/**
 * Detects clients where eagerly decoding a few hundred card images into
 * memory risks a per-tab memory eviction. The big one is iOS: Safari,
 * Chrome-iOS, and Firefox-iOS are ALL WebKit under the hood, and WebKit
 * enforces a hard per-tab memory budget — exceed it and the engine kills
 * and reloads the page. Symptom: open a pack on an iPhone, the tab silently
 * reloads, and you're bounced back to the "Open a new pack" screen mid-rip.
 *
 * On these clients we skip the background full-pool warm-up entirely. The
 * rip-time active preload (`lib/preload.ts`) still loads the ~15 images of
 * the actual pack being opened, so reveals stay smooth — we just don't
 * speculatively warm the other ~485 images the user may never see.
 *
 * Covers:
 *   • iPhone / iPod / iPad (incl. iPadOS 13+ which reports a Mac UA but
 *     exposes touch), and
 *   • any narrow-viewport device (Android phones included) — the warm-up
 *     is a desktop nicety, not worth the memory risk on a phone.
 */
function isMemoryConstrainedClient(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ masquerades as desktop Safari/Mac — disambiguate via
    // touch support, which a real Mac doesn't report.
    (/Macintosh/.test(ua) &&
      typeof document !== "undefined" &&
      "ontouchend" in document);
  if (isIOS) return true;
  if (typeof window.matchMedia === "function" && window.matchMedia("(max-width: 639px)").matches) {
    return true;
  }
  return false;
}

interface IdlePreloadOptions {
  /** How many URLs to start loading per idle tick. Bigger → faster
   *  warm-up but more network contention; smaller → friendlier to
   *  active scrolling/animations. */
  chunkSize?: number;
  /** Maximum URLs to load total. A safety cap so a buggy caller can't
   *  pass an enormous list. Defaults to 500. */
  maxImages?: number;
  /** Override the metered-connection guard for testing. */
  forceEnable?: boolean;
}

/**
 * Start a cancellable background pre-warm of `urls`. Returns a stop
 * function that callers should invoke on cleanup (useEffect return,
 * user-interaction handler, etc.).
 *
 * Duplicates and falsy entries are filtered. Already-completed images
 * resolve immediately and are dropped from the queue cheaply.
 */
export function idlePreloadImages(
  urls: ReadonlyArray<string | undefined>,
  options: IdlePreloadOptions = {},
): () => void {
  const { chunkSize = 5, maxImages = 500, forceEnable = false } = options;

  if (typeof window === "undefined") return () => {};
  if (!forceEnable && isMeteredConnection()) {
    // eslint-disable-next-line no-console
    console.info(
      "[idle-preload] skipping warm-up — metered/slow connection or saveData set",
    );
    return () => {};
  }
  if (!forceEnable && isMemoryConstrainedClient()) {
    // eslint-disable-next-line no-console
    console.info(
      "[idle-preload] skipping warm-up — memory-constrained mobile client (iOS/narrow viewport); rip-time preload still covers the opened pack",
    );
    return () => {};
  }

  // Deduplicate so we don't double-fetch tokens shared across packs.
  // Iteration order is stable; we prioritize the order callers gave.
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    if (!u || seen.has(u)) continue;
    seen.add(u);
    unique.push(u);
    if (unique.length >= maxImages) break;
  }
  if (unique.length === 0) return () => {};

  let cancelled = false;
  let nextIndex = 0;
  let handle: IdleHandle | null = null;
  // Keep a reference to in-flight Image objects so the GC doesn't reap
  // them mid-fetch before the network request completes.
  const inflight = new Set<HTMLImageElement>();

  const tick = (deadline: IdleDeadline) => {
    if (cancelled) return;
    const start = nextIndex;
    const end = Math.min(start + chunkSize, unique.length);
    for (let i = start; i < end; i++) {
      const url = unique[i];
      const img = new Image();
      inflight.add(img);
      const done = () => inflight.delete(img);
      img.onload = done;
      img.onerror = done;
      img.src = url;
    }
    nextIndex = end;
    if (nextIndex < unique.length) {
      // Continue on next idle. The didTimeout / timeRemaining values
      // could be used to pack more work in the same slot, but small
      // chunks keep things smooth on slow CPUs too — leave it.
      handle = scheduleIdle(tick);
    } else {
      handle = null;
    }
    // Suppress unused-warning on deadline in strict builds.
    void deadline;
  };

  handle = scheduleIdle(tick);

  return () => {
    cancelled = true;
    if (handle != null) {
      cancelIdle(handle);
      handle = null;
    }
    // Don't tear down in-flight requests — let the browser finish them
    // so the cache stays useful for the next page view. Just drop our
    // refs; GC handles the rest.
    inflight.clear();
  };
}

/**
 * Higher-level helper: take a multi-set CardPool, walk every card's
 * front-face JPEG URL (and back face for double-faced cards), and idle-
 * preload them. The "normal" variant (488 px wide) is used since that's
 * what the grid views in PackOpener/SealedRun/DraftRun render at; the
 * larger reveal-deck view will fall through to its own active preload
 * (`lib/preload.ts`) and pick up "large" on demand.
 *
 * Returns the same cancel function shape as `idlePreloadImages` so the
 * caller can stop on unmount or when active interaction begins.
 *
 * The `pool` param is a Record<setCode, ScryfallCard[]>; we accept the
 * broader `unknown[]`-style shape to avoid a circular type import from
 * lib/pack-open.ts — the only fields we actually touch are
 * `image_uris.normal` and `card_faces[].image_uris.normal`.
 */
interface IdlePreloadCard {
  image_uris?: { normal?: string; large?: string };
  card_faces?: ReadonlyArray<{
    image_uris?: { normal?: string; large?: string };
  }>;
}

export function idlePreloadCardPool(
  pool: Record<string, ReadonlyArray<IdlePreloadCard>>,
  options?: IdlePreloadOptions,
): () => void {
  const urls: string[] = [];
  for (const setCode of Object.keys(pool)) {
    const cards = pool[setCode];
    if (!cards) continue;
    for (const c of cards) {
      const front =
        c.image_uris?.normal ??
        c.image_uris?.large ??
        c.card_faces?.[0]?.image_uris?.normal ??
        c.card_faces?.[0]?.image_uris?.large;
      if (front) urls.push(front);
      // Back face for double-faced cards (DFCs). Skipped if absent.
      const back = c.card_faces?.[1]?.image_uris?.normal;
      if (back) urls.push(back);
    }
  }
  return idlePreloadImages(urls, options);
}
