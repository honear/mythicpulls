"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Search, Trash2, Sparkles, GripVertical } from "lucide-react";

/** Mobile breakpoint matcher used to scale binder card width.
 *  SSR-safe (defaults desktop). */
function useIsMobile(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 639px)");
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return m;
}
import {
  clearCollection,
  readCollection,
  setCollection,
  type CollectionEntry,
} from "@/lib/collection";
import { MagicCard } from "@/app/_components/MagicCard";
import { useDragReorder } from "@/lib/useDragReorder";
import { BinderCardModal } from "./BinderCardModal";

type SortMode = "manual" | "newest" | "rarity" | "set";

export function CollectionBinder() {
  const [entries, setEntries] = useState<CollectionEntry[]>([]);
  const [mounted, setMounted] = useState(false);
  const [sort, setSort] = useState<SortMode>("manual");
  const [query, setQuery] = useState("");
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  // entryId of the card whose detail modal is currently open. Cleared
  // when the modal closes. Mirrors PackOpener's `detailUid` pattern.
  const [detailKey, setDetailKey] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    setEntries(readCollection());
    // Default to all face-up on first mount
    setRevealed(new Set(readCollection().map(keyOf)));
    const onChange = () => setEntries(readCollection());
    window.addEventListener("mythicpulls:collection-change", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("mythicpulls:collection-change", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const stats = useMemo(() => {
    const counts = { common: 0, uncommon: 0, rare: 0, mythic: 0, total: entries.length, foils: 0 };
    for (const e of entries) {
      if (e.foil) counts.foils++;
      if (e.rarity in counts) (counts as Record<string, number>)[e.rarity]++;
    }
    return counts;
  }, [entries]);

  const view = useMemo(() => {
    const rarityOrder: Record<string, number> = {
      mythic: 0, rare: 1, uncommon: 2, common: 3, special: 4, bonus: 5,
    };
    let v = entries;
    const q = query.trim().toLowerCase();
    if (q) v = v.filter((e) => `${e.name} ${e.setCode}`.toLowerCase().includes(q));
    if (sort === "manual") return v;
    const copy = [...v];
    switch (sort) {
      case "newest":
        copy.sort((a, b) => b.pulledAt - a.pulledAt);
        break;
      case "rarity":
        copy.sort((a, b) => (rarityOrder[a.rarity] ?? 9) - (rarityOrder[b.rarity] ?? 9));
        break;
      case "set":
        copy.sort((a, b) => a.setCode.localeCompare(b.setCode));
        break;
    }
    return copy;
  }, [entries, sort, query]);

  function onReorder(from: number, to: number) {
    if (sort !== "manual") setSort("manual");
    const next = [...entries];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setEntries(next);
    setCollection(next);
  }

  function toggleFlip(key: string) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Tap router for binder cards — mirrors PackOpener.onTapCard so the
   *  binder feels consistent with the pack-reveal grid: face-down tap
   *  flips, face-up tap opens the detail modal (with the buy buttons). */
  function onTapCard(key: string) {
    if (revealed.has(key)) setDetailKey(key);
    else toggleFlip(key);
  }

  const detailEntry =
    detailKey != null ? entries.find((e) => keyOf(e) === detailKey) ?? null : null;

  if (!mounted) {
    return <div className="label-caps text-[var(--color-ink-muted)]">Loading…</div>;
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-2xl liquid-panel p-16 text-center">
        <div className="mx-auto w-16 h-16 rounded-2xl liquid-glass grid place-items-center mb-4">
          <Sparkles className="w-7 h-7 text-[var(--color-fg)]" />
        </div>
        <p className="font-display text-3xl text-[var(--color-fg)]">
          Your binder is empty.
        </p>
        <p className="mt-2 text-[var(--color-ink)]">
          Open a pack — your pulls will land here.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 mt-6 px-6 py-3 rounded-full bg-white text-[var(--color-bg)] text-sm font-semibold hover:bg-white/90 transition-colors"
        >
          Browse sets
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 sm:gap-3 mb-6 sm:mb-8">
        <Stat label="Total" value={stats.total} accent />
        <Stat label="Mythics" value={stats.mythic} color="var(--color-rarity-mythic)" />
        <Stat label="Rares" value={stats.rare} color="var(--color-rarity-rare)" />
        <Stat label="Uncommons" value={stats.uncommon} />
        <Stat label="Foils" value={stats.foils} color="var(--color-rarity-bonus)" />
      </div>

      <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between mb-5">
        <div className="flex flex-wrap gap-1 p-1 rounded-full liquid-glass">
          {(["manual", "newest", "rarity", "set"] as SortMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setSort(m)}
              className={`text-xs font-medium px-3 sm:px-4 py-2 rounded-full transition-colors ${
                sort === m
                  ? "bg-white text-[var(--color-bg)]"
                  : "text-[var(--color-ink)] hover:text-white"
              }`}
            >
              {m === "manual" ? "Sort · custom" : `Sort · ${m}`}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1 md:flex-initial">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-ink-muted)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or set…"
              className="pl-11 pr-4 py-2.5 rounded-full liquid-glass focus:outline-none w-full md:w-72 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-ink-muted)]/70"
            />
          </div>
          <button
            onClick={() => {
              if (confirm("Clear your entire collection? This cannot be undone.")) {
                clearCollection();
              }
            }}
            className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase px-3 py-2.5 rounded-full text-[var(--color-rarity-mythic)] liquid-glass hover:bg-white/10"
          >
            <Trash2 className="w-3.5 h-3.5" /> Clear
          </button>
        </div>
      </div>

      <p className="text-xs text-[var(--color-ink-muted)] mb-4 inline-flex items-center gap-2">
        <GripVertical className="w-3.5 h-3.5" />
        Click face-down to flip · click face-up to open · drag to reorder ·{" "}
        {sort !== "manual" && (
          <span className="text-[var(--color-rarity-rare)]">
            switch to “custom” sort to enable drag
          </span>
        )}
      </p>

      <BinderGrid
        entries={view}
        revealed={revealed}
        onReorder={onReorder}
        onTap={onTapCard}
        canReorder={sort === "manual" && !query}
      />

      <BinderCardModal entry={detailEntry} onClose={() => setDetailKey(null)} />
    </div>
  );
}

function keyOf(e: CollectionEntry) {
  // Use the entry's stable id rather than (cardId, pulledAt) — saving an
  // entire pack at once gave every card the same Date.now() value, and if
  // two of those cards happened to share a Scryfall id the composite key
  // collided. entryId is generated per-entry at save (or read) time.
  return e.entryId;
}

function BinderGrid({
  entries, revealed, onReorder, onTap, canReorder,
}: {
  entries: CollectionEntry[];
  revealed: Set<string>;
  onReorder: (from: number, to: number) => void;
  /** Routed by the parent: face-down → flip, face-up → open detail modal. */
  onTap: (key: string) => void;
  canReorder: boolean;
}) {
  const isMobile = useIsMobile();
  // Two cards per row on phones (~150px each); desktop keeps the 180px tile.
  const cardW = isMobile ? 150 : 180;
  const { bind } = useDragReorder({
    onReorder: canReorder ? onReorder : () => {},
    onTap: (i) => {
      const e = entries[i];
      if (e) onTap(keyOf(e));
    },
  });
  return (
    <ul
      className="grid gap-3 sm:gap-5"
      style={{
        gridTemplateColumns: `repeat(auto-fill, ${cardW}px)`,
        justifyContent: "center",
      }}
    >
      {entries.map((e, i) => {
        const key = keyOf(e);
        const bound = bind(i);
        return (
          <li
            key={key}
            ref={bound.ref as React.Ref<HTMLLIElement>}
            onPointerDown={bound.onPointerDown}
            onPointerMove={bound.onPointerMove}
            onPointerUp={bound.onPointerUp}
            onPointerCancel={bound.onPointerCancel}
            data-dragging={bound["data-dragging"]}
            data-drop-target={bound["data-drop-target"]}
            className={`anim-card-rise touch-none ${
              bound["data-dragging"] ? "card-dragging" : ""
            } ${
              canReorder && bound["data-drop-target"]
                ? "card-drop-target rounded-[12px]"
                : ""
            }`}
            style={{ animationDelay: `${Math.min(i * 15, 300)}ms`, ...bound.style }}
          >
            <MagicCard
              card={{
                kind: "lite",
                name: e.name,
                setCode: e.setCode,
                collectorNumber: e.collectorNumber,
                art: e.image,
                rarity: e.rarity,
                foil: e.foil,
              }}
              faceUp={revealed.has(key)}
              width={cardW}
            />
            <p className="mt-2 text-[10px] tracking-wider uppercase font-medium text-[var(--color-ink-muted)] truncate">
              {e.setCode.toUpperCase()} · #{e.collectorNumber}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function Stat({
  label, value, accent, color,
}: {
  label: string;
  value: number;
  accent?: boolean;
  color?: string;
}) {
  return (
    <div
      className={`rounded-2xl p-3 sm:p-5 ${
        accent ? "liquid-panel" : "liquid-glass"
      }`}
      style={accent ? { background: "linear-gradient(160deg, rgba(168,85,247,0.18), rgba(99,102,241,0.10))" } : undefined}
    >
      <p className="label-caps text-[var(--color-ink-muted)]">{label}</p>
      <p
        className="font-display text-3xl sm:text-4xl mt-1 leading-none text-[var(--color-fg)]"
        style={color ? { color } : undefined}
      >
        {value}
      </p>
    </div>
  );
}
