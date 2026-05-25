/**
 * Skeleton rendered while a per-set route is fetching its server data
 * (Scryfall cards for the main set + referenced sub-sets + tokens + the
 * pack recipe). Wrapped in a Suspense boundary by Next.js via each
 * route's `loading.tsx`, so it paints the moment the user clicks a set
 * instead of leaving them on the previous page with no feedback.
 *
 * Three modes mirror the three landing chromes:
 *   • "pack"   — `/sets/[code]`   — pack opener
 *   • "draft"  — `/draft/[code]`  — 8-seat booster draft
 *   • "sealed" — `/sealed/[code]` — 6-pack sealed run
 *
 * The chrome (back link, set icon placeholder, name placeholder) is
 * shared. Below that we render a mode-specific body placeholder that
 * roughly traces the destination layout, so the transition from
 * skeleton → real content feels like the same surface filling in.
 */
export function SetPageSkeleton({ mode }: { mode: "pack" | "draft" | "sealed" }) {
  const label =
    mode === "pack" ? "OPENING" : mode === "draft" ? "DRAFT" : "SEALED";
  const subline =
    mode === "pack"
      ? "Loading pack…"
      : mode === "draft"
        ? "Loading draft table…"
        : "Loading sealed pool…";

  return (
    <div className="flex flex-col" aria-busy="true" aria-live="polite">
      {/* Header chrome — mirrors app/(set|draft|sealed)/[code]/page.tsx. */}
      <div className="mx-auto max-w-7xl w-full px-4 sm:px-6 pt-24 sm:pt-28 md:pt-32">
        <p className="label-caps text-[var(--color-ink-muted)]">
          ← {mode === "pack" ? "All sets" : "Pick a different set"}
        </p>
        <div className="flex items-start gap-3 sm:gap-5 mt-3 sm:mt-4">
          {/* Icon placeholder. */}
          <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-xl shrink-0 liquid-panel skeleton-pulse" />
          <div className="min-w-0 flex-1">
            <p className="label-caps text-[var(--color-ink-muted)]">
              {label} · LOADING · ····
            </p>
            {/* Title bar — two lines worth of height so the chrome
                doesn't visibly resize when the real h1 renders. */}
            <div className="h-9 sm:h-10 md:h-14 mt-1 sm:mt-2 max-w-[420px] rounded-md skeleton-pulse" />
            <div className="h-4 mt-2 sm:mt-3 max-w-[280px] rounded skeleton-pulse" />
          </div>
        </div>
      </div>

      {/* Body placeholder — generous, centered, matches the resting
          minHeight of the real components so the layout doesn't jolt. */}
      <section className="mx-auto max-w-7xl w-full px-4 sm:px-6 py-8">
        <div
          className="relative rounded-2xl liquid-panel overflow-hidden grid place-items-center text-center px-6 py-8"
          style={{
            minHeight: 540,
            background: `
              radial-gradient(ellipse 90% 75% at 50% 45%, rgba(123, 57, 252, 0.22), rgba(123, 57, 252, 0.08) 40%, transparent 75%)
            `,
          }}
        >
          <div className="flex flex-col items-center gap-4">
            <span
              className="inline-block w-6 h-6 rounded-full border-2 border-[var(--accent-purple-light)] border-t-transparent animate-spin"
              aria-hidden
            />
            <p
              className="label-caps text-[var(--accent-purple-light)]"
              style={{ fontFamily: "var(--font-ui)" }}
            >
              {subline}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
