"use client";

import Link, { useLinkStatus } from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { ScryfallSet } from "@/lib/scryfall";
import { setHasDraftStats } from "@/lib/draft-stats-meta";
import type { SetArtEntry } from "@/lib/set-art";

type Filter = "all" | "recent" | "modern" | "legacy";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "recent", label: "Recent" },
  { id: "modern", label: "Modern era" },
  { id: "legacy", label: "Legacy" },
  { id: "all", label: "All" },
];

export function SetGrid({
  sets,
  sampleArt = {},
  linkBase = "/sets",
  tileLabel = "Open",
  showDraftStatsBadge = false,
}: {
  sets: ScryfallSet[];
  /** Per-set art credits keyed by lowercased set code. Each entry is
   *  `{ url, artist, cardName }`. Sets without an entry fall back to
   *  icon-only tiles with no tooltip. */
  sampleArt?: Record<string, SetArtEntry>;
  /** Path prefix for each tile link. `/sets` (default) drops you in the
   *  single-pack opener; `/sealed` drops you in the 6-pack sealed flow. */
  linkBase?: string;
  /** Short label shown in the bottom-right pill on each tile (e.g.
   *  "Open" for /sets, "Play" for /sealed). */
  tileLabel?: string;
  /** Whether to show the small "17L" badge on tiles with 17Lands data.
   *  Only meaningful on the Booster Draft set picker — the bots are the
   *  only feature that consumes the aggregates. Sealed and the
   *  pack-opening flow ignore 17Lands data, so we hide the badge there
   *  to avoid implying the data is influencing those experiences. */
  showDraftStatsBadge?: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("recent");
  const [query, setQuery] = useState("");

  // Measured column count of the rendered grid, used to trim the
  // "Recent" filter so it never ends in an orphan row (e.g., 17 sets
  // at 8 cols would render 8 + 8 + 1, leaving one lonely tile). When
  // we know the column count we slice the array to the largest
  // multiple of cols that's ≤ the natural length. Initial value 0
  // means "haven't measured yet" — the first render falls through to
  // the un-trimmed list, then the ResizeObserver in the effect below
  // fires and we re-render with the trimmed slice. Single-frame
  // flicker on cold load only.
  const gridRef = useRef<HTMLUListElement | null>(null);
  const [cols, setCols] = useState<number>(0);
  useEffect(() => {
    const el = gridRef.current;
    if (!el || typeof window === "undefined") return;
    const measure = () => {
      // `gridTemplateColumns` resolves to a space-separated list of
      // computed track sizes (e.g. "152.5px 152.5px 152.5px ..."), one
      // entry per column. Counting those entries gives us the live
      // column count regardless of Tailwind breakpoint.
      const tpl = getComputedStyle(el).gridTemplateColumns;
      const n = tpl.split(/\s+/).filter(Boolean).length;
      if (n > 0) setCols(n);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = new Date();
    return sets.filter((s) => {
      if (q && !`${s.name} ${s.code}`.toLowerCase().includes(q)) return false;
      if (!s.released_at) return filter === "all";
      const year = parseInt(s.released_at.slice(0, 4), 10);
      switch (filter) {
        case "recent": {
          const cutoff = new Date(now);
          cutoff.setFullYear(cutoff.getFullYear() - 2);
          return new Date(s.released_at) >= cutoff;
        }
        case "modern":
          return year >= 2003;
        case "legacy":
          return year < 2003;
        case "all":
        default:
          return true;
      }
    });
  }, [sets, filter, query]);

  return (
    <div>
      <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between mb-4">
        <div
          className="flex flex-wrap gap-1 p-1 rounded-full liquid-glass"
          style={{ fontFamily: "var(--font-ui)" }}
        >
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`text-xs px-4 py-2 rounded-full font-medium transition-colors ${
                filter === f.id
                  ? "text-white"
                  : "text-[var(--color-ink)] hover:text-white"
              }`}
              style={
                filter === f.id
                  ? { background: "var(--accent-purple)" }
                  : undefined
              }
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative md:w-80">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-ink-muted)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search set by name or code…"
            // text-base (16px) on mobile to avoid iOS Safari's
            // auto-zoom on focus (any input < 16px triggers a 1.5×
            // page zoom that breaks layout until reload).
            // sm:text-sm restores the smaller text on tablet+.
            className="w-full pl-11 pr-4 py-3 rounded-full liquid-glass focus:outline-none text-base sm:text-sm text-[var(--color-fg)] placeholder:text-[var(--color-ink-muted)]/70"
            style={{ fontFamily: "var(--font-ui)" }}
          />
        </div>
      </div>

      {(() => {
        // Orphan-row trim: when the user is on "Recent" with no active
        // search, slice the natural list down to the largest multiple
        // of `cols` that fits. Other filters (Modern / Legacy / All)
        // and active searches keep the full list — losing 1-5 results
        // there would be confusing ("where's the set I searched for?").
        // The clip is gated on cols > 0 so SSR + first paint show the
        // un-trimmed list, then the ResizeObserver fires and a second
        // render trims to fit.
        const trimRecent = filter === "recent" && !query.trim() && cols > 0;
        const visible = trimRecent
          ? filtered.slice(0, Math.floor(filtered.length / cols) * cols)
          : filtered;
        if (visible.length === 0) return <Empty />;
        return (
          <ul
            ref={gridRef}
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3"
          >
            {visible.map((s, i) => (
              <SetTile
                key={s.id}
                set={s}
                index={i}
                artEntry={sampleArt[s.code.toLowerCase()]}
                linkBase={linkBase}
                tileLabel={tileLabel}
                showDraftStatsBadge={showDraftStatsBadge}
              />
            ))}
          </ul>
        );
      })()}
    </div>
  );
}

function SetTile({
  set, index, artEntry, linkBase, tileLabel, showDraftStatsBadge,
}: {
  set: ScryfallSet;
  index: number;
  artEntry?: SetArtEntry;
  linkBase: string;
  tileLabel: string;
  showDraftStatsBadge: boolean;
}) {
  const year = set.released_at?.slice(0, 4) ?? "—";
  // Show a small "17L" badge on tiles whose set has a corresponding
  // aggregate in data/draft-stats/<code>.json AND we're on the Draft
  // picker. The bots are the only feature that consumes the data, so
  // the badge would mislead users into thinking sealed / pack-opening
  // are also tuned by 17Lands when they aren't.
  // Premier Draft data for this set.
  const hasStats = showDraftStatsBadge && setHasDraftStats(set.code);
  const artUrl = artEntry?.url;
  // Build the tooltip with set name, year, and (when present) the
  // featured card + artist — so the artist gets credit via the
  // browser tooltip on hover without cluttering the tile. The art is
  // the same image used as the tile background, so the tooltip text
  // honestly describes what the user is looking at.
  const tooltip = artEntry?.artist
    ? `${set.name} · ${year}\nArt: ${artEntry.cardName ?? "—"} by ${artEntry.artist}`
    : `${set.name} · ${year}`;

  return (
    <li
      className="anim-card-rise"
      style={{ animationDelay: `${Math.min(index * 14, 200)}ms` }}
    >
      <Link
        href={`${linkBase}/${set.code.toLowerCase()}`}
        className="group relative block aspect-square liquid-panel hover:bg-white/8 transition-colors lift overflow-hidden"
        title={tooltip}
      >
        {/* Per-set art-crop background. Darkened heavily so the icon + text
            stay readable; brightens on hover for a subtle reveal. */}
        {artUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover transition-all duration-500 group-hover:scale-110"
            style={{
              filter: "brightness(0.38) saturate(0.9) contrast(1.05)",
            }}
          />
        )}
        {/* Dark gradient overlay to lock contrast for the overlaid text. */}
        {artUrl && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "linear-gradient(180deg, rgba(13,8,28,0.45) 0%, rgba(13,8,28,0.0) 30%, rgba(13,8,28,0.0) 70%, rgba(13,8,28,0.65) 100%)",
            }}
          />
        )}
        <div className="absolute inset-0 grid place-items-center">
          {set.icon_svg_uri ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={set.icon_svg_uri}
              alt=""
              className="w-12 h-12 object-contain transition-transform duration-300 group-hover:scale-110"
              style={{
                filter: artUrl
                  ? "brightness(0) invert(1) drop-shadow(0 4px 12px rgba(0,0,0,0.7))"
                  : "brightness(0) invert(1)",
              }}
            />
          ) : (
            <span className="font-display text-3xl text-[var(--color-fg)]">
              {set.code.slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>
        <div className="absolute top-2 left-3 right-3 flex items-center justify-between gap-2">
          <span className="text-[10px] tracking-[0.16em] uppercase font-semibold text-[var(--color-ink-muted)]">
            {set.code.toUpperCase()}
          </span>
          <div className="flex items-center gap-1.5">
            {hasStats && (
              <span
                title="17Lands Premier Draft data available for this set"
                aria-label="17Lands Premier Draft data available for this set"
                className="text-[9px] tracking-[0.14em] uppercase font-bold px-1.5 py-0.5 rounded"
                style={{
                  background: "rgba(123,57,252,0.28)",
                  color: "var(--accent-purple-light)",
                  border: "1px solid rgba(164,132,215,0.4)",
                  fontFamily: "var(--font-btn)",
                }}
              >
                17L
              </span>
            )}
            <span className="text-[10px] tracking-[0.16em] uppercase text-[var(--color-ink-muted)]">
              {year}
            </span>
          </div>
        </div>
        <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between gap-2">
          <p
            className="text-[11px] font-medium text-[var(--color-fg)] truncate"
            style={{ fontFamily: "var(--font-ui)" }}
          >
            {set.name}
          </p>
          <span
            className="text-[9px] tracking-[0.18em] uppercase font-semibold shrink-0 px-1.5 py-0.5 rounded-md transition-colors group-hover:bg-[var(--accent-purple)] group-hover:text-white"
            style={{
              fontFamily: "var(--font-btn)",
              color: "var(--accent-purple-light)",
              background: "rgba(123,57,252,0.18)",
            }}
          >
            {tileLabel}
          </span>
        </div>
        <TileLoadingOverlay />
      </Link>
    </li>
  );
}

/**
 * Spinner overlay shown while a set tile's destination is fetching.
 * Uses Next 16's `useLinkStatus` (must be a descendant of <Link>).
 *
 * The overlay is always mounted so the CSS `animation-delay: 120ms`
 * trick can suppress flashes on fast (prefetched) navigations —
 * only routes that actually take >120ms to resolve get a visible
 * spinner. That's the same pattern Next recommends for inline link
 * hints in their useLinkStatus docs.
 */
function TileLoadingOverlay() {
  const { pending } = useLinkStatus();
  return (
    <div
      aria-hidden={!pending}
      className={`tile-loading ${pending ? "is-pending" : ""}`}
    >
      <span className="tile-loading__spinner" />
    </div>
  );
}

function Empty() {
  return (
    <div className="rounded-2xl liquid-panel p-12 text-center text-[var(--color-ink)]">
      <p className="font-display text-3xl text-[var(--color-fg)]">No sets match.</p>
      <p className="mt-2 text-sm">Try a different filter or clear your search.</p>
    </div>
  );
}
