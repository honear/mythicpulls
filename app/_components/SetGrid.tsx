"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { ScryfallSet } from "@/lib/scryfall";
import { recommendedPackType, PACKS } from "@/lib/pack-rules";

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
}: {
  sets: ScryfallSet[];
  /** Per-set art-crop URLs keyed by lowercased set code. Optional — sets
   *  without an entry fall back to icon-only. */
  sampleArt?: Record<string, string>;
}) {
  const [filter, setFilter] = useState<Filter>("recent");
  const [query, setQuery] = useState("");

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
      <div className="flex flex-col md:flex-row gap-4 md:items-center md:justify-between mb-6">
        <div className="flex flex-wrap gap-1 p-1 rounded-full liquid-glass">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`text-xs px-4 py-2 rounded-full font-medium transition-colors ${
                filter === f.id
                  ? "bg-white text-[var(--color-bg)]"
                  : "text-[var(--color-ink)] hover:text-white"
              }`}
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
            className="w-full pl-11 pr-4 py-3 rounded-full liquid-glass focus:outline-none text-sm text-[var(--color-fg)] placeholder:text-[var(--color-ink-muted)]/70"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <Empty />
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
          {filtered.map((s, i) => (
            <SetTile
              key={s.id}
              set={s}
              index={i}
              artUrl={sampleArt[s.code.toLowerCase()]}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SetTile({
  set, index, artUrl,
}: {
  set: ScryfallSet;
  index: number;
  artUrl?: string;
}) {
  const recommended = recommendedPackType(set);
  const year = set.released_at?.slice(0, 4) ?? "—";
  const rec = PACKS[recommended].name.replace(" Booster", "");

  return (
    <li
      className="anim-card-rise"
      style={{ animationDelay: `${Math.min(index * 14, 200)}ms` }}
    >
      <Link
        href={`/sets/${set.code.toLowerCase()}`}
        className="group relative block aspect-square liquid-panel hover:bg-white/8 transition-colors lift overflow-hidden"
        title={`${set.name} · ${year}`}
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
        <div className="absolute top-2 left-3 right-3 flex items-center justify-between">
          <span className="text-[10px] tracking-[0.16em] uppercase font-semibold text-[var(--color-ink-muted)]">
            {set.code.toUpperCase()}
          </span>
          <span className="text-[10px] tracking-[0.16em] uppercase text-[var(--color-ink-muted)]">
            {year}
          </span>
        </div>
        <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium text-[var(--color-fg)] truncate">
            {set.name}
          </p>
          <span className="text-[9px] tracking-[0.14em] uppercase font-semibold text-[var(--color-ink-muted)]/80 shrink-0">
            {rec}
          </span>
        </div>
      </Link>
    </li>
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
