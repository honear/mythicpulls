"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Download, Copy, X, Plus, Minus, ArrowDownAZ, Palette,
} from "lucide-react";
import type { ScryfallCard } from "@/lib/scryfall";
import type { PulledCard } from "@/lib/pack-open";
import { MagicCard } from "@/app/_components/MagicCard";
import {
  exportDeckText,
  emptyBasicLandCounts,
  totalDeckSize,
  type BasicLandCounts,
} from "@/lib/deck-export";

/* ===========================================================================
   Sealed Deck Builder
   ---------------------------------------------------------------------------
   Two zones: a column-stacked deck on top, a 7-wide pool grid on the bottom.
   Cards move between zones via two affordances:
     • Click  — pool → deck (defaultBucket), deck → pool (remove)
     • Drag   — pointer-based, capture-on-press, cursor-following ghost. Drop
                targets are flagged with data-drop-zone (and data-column for
                deck columns). elementFromPoint at pointerup decides where
                the card lands.
   Holds three pieces of state per uid:
     • inDeck      — Set of uids in the deck
     • overrides   — Map<uid, columnId> set by deck-column drops; clears on
                     "Sort by mana"
     • lands       — basic land counters (W/U/B/R/G/C), independent of pool
   =========================================================================== */

const DECK_MIN = 40;

const POOL_COLUMNS = 7;
const POOL_CARD_W = 168;

const DECK_CARD_W = 168;
const DECK_STACK_OFFSET = 38;       // px between stacked cards in a column
const DECK_VISIBLE_COLUMNS = 7;

const HOVER_DELAY_MS = 200;
const DRAG_THRESHOLD = 6;
const PREVIEW_W = 320;

type ColumnId = number | "L";

/** Canonical column order — drives left-to-right rendering when multiple
 *  buckets are populated. Anything >= 7 collapses into the 7 column. */
const ALL_BUCKETS: ColumnId[] = [0, 1, 2, 3, 4, 5, 6, 7, "L"];

function bucketLabel(b: ColumnId): string {
  if (b === "L") return "Lands";
  if (b === 7) return "7+";
  return String(b);
}

function isLand(card: ScryfallCard): boolean {
  return (card.type_line ?? "").toLowerCase().includes("land");
}

function defaultBucket(card: ScryfallCard): ColumnId {
  if (isLand(card)) return "L";
  const n = Math.max(0, Math.round(card.cmc ?? 0));
  return n >= 7 ? 7 : n;
}

function bucketCompare(a: ColumnId, b: ColumnId): number {
  const ai = a === "L" ? 100 : a;
  const bi = b === "L" ? 100 : b;
  return ai - bi;
}

/* -------- Pool sorting --------
 * "mana" — lands last, then mana value, then name.
 * "color" — group by primary color (W/U/B/R/G), then multicolor,
 *           then colorless, then lands; within each band sort by
 *           mana value, then name. Matches the rough conventions
 *           draft-deck-builders tend to use. */
const COLOR_BANDS = ["W", "U", "B", "R", "G"] as const;
function colorBand(card: ScryfallCard): number {
  if (isLand(card)) return 100;
  const colors = card.colors ?? [];
  if (colors.length === 0) return 60;       // colorless
  if (colors.length > 1) return 50;         // multicolor
  const idx = (COLOR_BANDS as readonly string[]).indexOf(colors[0]);
  return idx >= 0 ? idx : 99;
}
function compareByMana(a: PulledCard[], b: PulledCard[]): number {
  const al = isLand(a[0].card) ? 1 : 0;
  const bl = isLand(b[0].card) ? 1 : 0;
  if (al !== bl) return al - bl;
  const ac = a[0].card.cmc ?? 0;
  const bc = b[0].card.cmc ?? 0;
  if (ac !== bc) return ac - bc;
  return a[0].card.name.localeCompare(b[0].card.name);
}
function compareByColor(a: PulledCard[], b: PulledCard[]): number {
  const ak = colorBand(a[0].card);
  const bk = colorBand(b[0].card);
  if (ak !== bk) return ak - bk;
  const ac = a[0].card.cmc ?? 0;
  const bc = b[0].card.cmc ?? 0;
  if (ac !== bc) return ac - bc;
  return a[0].card.name.localeCompare(b[0].card.name);
}

const BASIC_LANDS: { name: keyof BasicLandCounts; symbol: string; color: string }[] = [
  { name: "Plains",   symbol: "W", color: "#f5efce" },
  { name: "Island",   symbol: "U", color: "#a3c9ec" },
  { name: "Swamp",    symbol: "B", color: "#7d6d6d" },
  { name: "Mountain", symbol: "R", color: "#e09a89" },
  { name: "Forest",   symbol: "G", color: "#9bc795" },
  { name: "Wastes",   symbol: "C", color: "#cbcbcb" },
];

/** uids for basic land "instances" rendered inside the deck Lands column.
 *  They're synthetic — basic lands live in the `lands` counter state, not
 *  the `inDeck` Set — but we forge PulledCard-shaped entries so they slot
 *  into the same render path as real pulls. */
function basicLandUid(name: keyof BasicLandCounts, index: number): string {
  return `basic:${name}#${index}`;
}
function isBasicLandUid(uid: string): boolean {
  return uid.startsWith("basic:");
}
function parseBasicLandName(uid: string): keyof BasicLandCounts | null {
  if (!isBasicLandUid(uid)) return null;
  const after = uid.slice("basic:".length);   // "Plains#3"
  const name = after.split("#")[0];
  if (BASIC_LANDS.some((b) => b.name === name)) return name as keyof BasicLandCounts;
  return null;
}

interface SetMeta { code: string; name: string; iconUri?: string }
interface Props {
  setMeta: SetMeta;
  pool: PulledCard[];
  basicLandSamples: Partial<Record<string, ScryfallCard>>;
}

interface DragState {
  uid: string;
  card: ScryfallCard;
  foil: boolean;
  source: "pool" | "deck";
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
}
interface PreviewState {
  card: ScryfallCard;
  foil: boolean;
  x: number;
  y: number;
}

/* ============================================================
   Component
   ============================================================ */

type PoolSort = "mana" | "color";

export function SealedDeckBuilder({ setMeta, pool, basicLandSamples }: Props) {
  const [inDeck, setInDeck] = useState<Set<string>>(() => new Set());
  /** Per-uid column override. Empty by default → cards bucket by CMC.
   *  "Sort by mana" button clears the map. */
  const [overrides, setOverrides] = useState<Map<string, ColumnId>>(() => new Map());
  const [lands, setLands] = useState<BasicLandCounts>(() => emptyBasicLandCounts());
  const [exportOpen, setExportOpen] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [poolSort, setPoolSort] = useState<PoolSort>("mana");
  const hoverTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
  }, []);

  /* -------- card-move primitives -------- */

  function addToDeck(uid: string, column: ColumnId) {
    setInDeck((prev) => {
      if (prev.has(uid)) return prev;
      const next = new Set(prev);
      next.add(uid);
      return next;
    });
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(uid, column);
      return next;
    });
  }
  function removeFromDeck(uid: string) {
    setInDeck((prev) => {
      if (!prev.has(uid)) return prev;
      const next = new Set(prev);
      next.delete(uid);
      return next;
    });
    setOverrides((prev) => {
      const next = new Map(prev);
      next.delete(uid);
      return next;
    });
  }
  function moveToColumn(uid: string, column: ColumnId) {
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(uid, column);
      return next;
    });
  }
  function sortByMana() {
    setOverrides(new Map());
  }
  function bumpLand(name: keyof BasicLandCounts, delta: number) {
    setLands((prev) => ({ ...prev, [name]: Math.max(0, prev[name] + delta) }));
  }

  /* -------- hover preview -------- */

  function clearHover() {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setPreview(null);
  }
  const armHover = useCallback(
    (p: PulledCard, e: React.PointerEvent) => {
      if (e.pointerType === "touch") return;
      // Reset whatever was queued (different card or just moved cursor)
      if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
      const x = e.clientX;
      const y = e.clientY;
      hoverTimerRef.current = window.setTimeout(() => {
        setPreview({ card: p.card, foil: p.foil, x, y });
      }, HOVER_DELAY_MS);
    },
    [],
  );

  /* -------- drag plumbing -------- */

  function startDrag(p: PulledCard, source: "pool" | "deck", e: React.PointerEvent<HTMLElement>) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    clearHover();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    setDrag({
      uid: p.uid,
      card: p.card,
      foil: p.foil,
      source,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      active: false,
    });
  }

  function moveDrag(e: React.PointerEvent<HTMLElement>) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const past = dx * dx + dy * dy >= DRAG_THRESHOLD * DRAG_THRESHOLD;
    setDrag({ ...drag, x: e.clientX, y: e.clientY, active: drag.active || past });
  }

  function endDrag(e: React.PointerEvent<HTMLElement>) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const wasActive = drag.active;
    const dropTarget =
      wasActive
        ? document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-drop-zone]") as HTMLElement | null
        : null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}

    // Basic-land uids are synthetic — they bypass the inDeck/overrides
    // system and modify the `lands` counter instead. Removing one from
    // the deck (via tap or drag-to-pool) just decrements its counter;
    // they always live in the Lands column so column moves are no-ops.
    const isBasic = isBasicLandUid(drag.uid);
    const basicName = isBasic ? parseBasicLandName(drag.uid) : null;

    if (!wasActive) {
      // Treat as a tap — pool→deck (default bucket) or deck→pool.
      if (drag.source === "pool") {
        addToDeck(drag.uid, defaultBucket(drag.card));
      } else if (isBasic && basicName) {
        bumpLand(basicName, -1);
      } else {
        removeFromDeck(drag.uid);
      }
    } else if (dropTarget) {
      const zone = dropTarget.getAttribute("data-drop-zone");
      if (zone === "pool") {
        if (drag.source === "deck") {
          if (isBasic && basicName) bumpLand(basicName, -1);
          else removeFromDeck(drag.uid);
        }
      } else if (zone === "deck-column") {
        // Basic lands always live in the Lands column — ignore column
        // overrides for them. Real cards get the normal move/add semantics.
        if (isBasic) {
          // no-op
        } else {
          const colAttr = dropTarget.getAttribute("data-column");
          const column: ColumnId = colAttr === "L" ? "L" : parseInt(colAttr ?? "0", 10);
          if (drag.source === "pool") addToDeck(drag.uid, column);
          else moveToColumn(drag.uid, column);
        }
      } else if (zone === "deck") {
        // Dropped on the deck panel but not a specific column — use the
        // default bucket for the card.
        if (drag.source === "pool") addToDeck(drag.uid, defaultBucket(drag.card));
      }
    }

    setDrag(null);
  }

  function cancelDrag() {
    setDrag(null);
  }

  /* -------- derived views -------- */

  const deckCards = useMemo(() => pool.filter((p) => inDeck.has(p.uid)), [pool, inDeck]);
  const poolCards = useMemo(() => pool.filter((p) => !inDeck.has(p.uid)), [pool, inDeck]);

  /** Group deck cards into columns based on overrides + defaults, then by
   *  card id within each column so duplicates stack tightly together.
   *  Also synthesizes PulledCard-shaped entries for basic land counts and
   *  drops them into the Lands ("L") column so the player can see them
   *  alongside their non-basic lands. Basic lands carry uids of the form
   *  `basic:<Name>#<i>` which the drag/click handlers recognize. */
  const deckColumns = useMemo(() => {
    const byCol = new Map<ColumnId, Map<string, PulledCard[]>>();
    for (const p of deckCards) {
      const col = overrides.get(p.uid) ?? defaultBucket(p.card);
      let colMap = byCol.get(col);
      if (!colMap) {
        colMap = new Map();
        byCol.set(col, colMap);
      }
      const list = colMap.get(p.card.id) ?? [];
      list.push(p);
      colMap.set(p.card.id, list);
    }

    // Synthesize basic-land entries into the Lands column.
    let landsColMap = byCol.get("L");
    for (const ld of BASIC_LANDS) {
      const count = lands[ld.name];
      if (count <= 0) continue;
      const sample = basicLandSamples[ld.name];
      if (!sample) continue;  // No sample card to render — skip gracefully.
      if (!landsColMap) {
        landsColMap = new Map();
        byCol.set("L", landsColMap);
      }
      const arr: PulledCard[] = [];
      for (let i = 0; i < count; i++) {
        arr.push({
          uid: basicLandUid(ld.name, i),
          card: sample,
          slotIndex: 0,
          slotLabel: "Basic Land",
          foil: false,
        });
      }
      landsColMap.set(`basic:${ld.name}`, arr);
    }

    return ALL_BUCKETS
      .filter((b) => byCol.has(b))
      .sort(bucketCompare)
      .map((b) => ({
        bucket: b,
        groups: Array.from(byCol.get(b)!.values()).sort((a, c) => {
          const ac = a[0].card.cmc ?? 0;
          const bc = c[0].card.cmc ?? 0;
          if (ac !== bc) return ac - bc;
          return a[0].card.name.localeCompare(c[0].card.name);
        }),
      }));
  }, [deckCards, overrides, lands, basicLandSamples]);

  /** Pool view — collapse duplicates by card id, then sort by either mana
   *  value or primary color depending on the toggle. Lands always go last. */
  const poolGroups = useMemo(() => {
    const m = new Map<string, PulledCard[]>();
    for (const p of poolCards) {
      const list = m.get(p.card.id) ?? [];
      list.push(p);
      m.set(p.card.id, list);
    }
    const arr = Array.from(m.values());
    if (poolSort === "color") return arr.sort(compareByColor);
    return arr.sort(compareByMana);
  }, [poolCards, poolSort]);

  const deckSize = totalDeckSize(deckCards.map((p) => p.card), lands);
  const remaining = Math.max(0, DECK_MIN - deckSize);
  const validDeck = deckSize >= DECK_MIN;

  const sharedHandlers = {
    startDrag,
    moveDrag,
    endDrag,
    cancelDrag,
    armHover,
    clearHover,
  };

  return (
    <section className="mx-auto max-w-[1600px] w-full px-6 pb-24">
      <DeckHeader
        deckSize={deckSize}
        deckMin={DECK_MIN}
        remaining={remaining}
        valid={validDeck}
        onSortByMana={sortByMana}
        onExport={() => setExportOpen(true)}
      />

      {/* DECK */}
      <div
        data-drop-zone="deck"
        className="rounded-2xl liquid-panel overflow-hidden mb-5"
        style={{
          outline: drag?.active && drag.source === "pool"
            ? "2px dashed var(--accent-purple-light)"
            : undefined,
          outlineOffset: -4,
        }}
      >
        <PanelHeader
          title="Deck"
          subtitle={
            deckColumns.length === 0
              ? "Drag (or click) pool cards into a column to add them"
              : "Click to remove · drag between columns to override placement"
          }
          countLabel={`${deckCards.length} from pool`}
        />
        <div className="px-4 py-3 overflow-x-auto">
          {deckColumns.length === 0 && !drag?.active ? (
            <EmptyDeckTarget />
          ) : (
            <div
              className="flex items-start gap-2"
              style={{ minWidth: DECK_VISIBLE_COLUMNS * (DECK_CARD_W + 14) }}
            >
              {/* While a drag is active we render every possible bucket
                  (0..7+ and Lands), even empty ones. That gives the user a
                  drop target for any mana value, so a pool card can land in
                  a column the deck doesn't have any cards in yet. Empty
                  columns show a dashed placeholder. */}
              {(drag?.active
                ? ALL_BUCKETS.map((b) =>
                    deckColumns.find((c) => c.bucket === b) ?? { bucket: b, groups: [] },
                  )
                : deckColumns
              ).map(({ bucket, groups }) => (
                <DeckColumn
                  key={String(bucket)}
                  bucket={bucket}
                  groups={groups}
                  drag={drag}
                  handlers={sharedHandlers}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Basic lands */}
      <BasicLandRow lands={lands} onBump={bumpLand} />

      {/* POOL */}
      <div
        data-drop-zone="pool"
        className="rounded-2xl liquid-panel overflow-hidden mt-6"
        style={{
          outline: drag?.active && drag.source === "deck"
            ? "2px dashed var(--accent-purple-light)"
            : undefined,
          outlineOffset: -4,
        }}
      >
        <PanelHeader
          title="Pool"
          subtitle={
            poolGroups.length === 0
              ? "Every pulled card is in the deck."
              : "Click to add · drag onto a deck column to place"
          }
          countLabel={`${poolCards.length} card${poolCards.length === 1 ? "" : "s"}`}
          right={<PoolSortToggle value={poolSort} onChange={setPoolSort} />}
        />
        <div className="px-4 py-3">
          {poolGroups.length === 0 ? (
            <EmptyState message="No pool cards. Everything is currently in the deck." />
          ) : (
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: `repeat(${POOL_COLUMNS}, minmax(0, 1fr))`,
              }}
            >
              {poolGroups.map((groupCards) => (
                <PoolTile
                  key={groupCards[0].card.id}
                  groupCards={groupCards}
                  drag={drag}
                  handlers={sharedHandlers}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {drag?.active && (
        <DragGhost card={drag.card} foil={drag.foil} x={drag.x} y={drag.y} />
      )}
      {preview && !drag && (
        <HoverPreview card={preview.card} foil={preview.foil} x={preview.x} y={preview.y} />
      )}

      {exportOpen && (
        <ExportModal
          deckCards={deckCards.map((p) => p.card)}
          lands={lands}
          basicLandSamples={basicLandSamples}
          setMeta={setMeta}
          onClose={() => setExportOpen(false)}
        />
      )}
    </section>
  );
}

/* ============================================================
   Card tiles
   ============================================================ */

interface SharedHandlers {
  startDrag: (p: PulledCard, source: "pool" | "deck", e: React.PointerEvent<HTMLElement>) => void;
  moveDrag: (e: React.PointerEvent<HTMLElement>) => void;
  endDrag: (e: React.PointerEvent<HTMLElement>) => void;
  cancelDrag: () => void;
  armHover: (p: PulledCard, e: React.PointerEvent) => void;
  clearHover: () => void;
}

function PoolTile({
  groupCards, drag, handlers,
}: {
  groupCards: PulledCard[];
  drag: DragState | null;
  handlers: SharedHandlers;
}) {
  const head = groupCards[0];
  const count = groupCards.length;
  const beingDragged = drag?.active && drag.uid === head.uid;

  return (
    <button
      onPointerDown={(e) => handlers.startDrag(head, "pool", e)}
      onPointerMove={(e) => { handlers.moveDrag(e); handlers.armHover(head, e); }}
      onPointerUp={handlers.endDrag}
      onPointerCancel={handlers.cancelDrag}
      onPointerLeave={handlers.clearHover}
      className="relative block focus:outline-none transition-transform hover:-translate-y-1 touch-none"
      style={{
        width: "100%",
        opacity: beingDragged ? 0.35 : 1,
      }}
      aria-label={`${head.card.name}${count > 1 ? ` (×${count})` : ""} — click to add to deck`}
    >
      <MagicCard
        card={{ kind: "scryfall", card: head.card, foil: false }}
        faceUp
        width={POOL_CARD_W}
        holoEnabled={false}
      />
      {count > 1 && (
        <span
          className="absolute top-1 right-1 grid place-items-center rounded-full text-[12px] font-bold leading-none px-2 py-1 z-10"
          style={{
            background: "var(--accent-purple)",
            color: "white",
            boxShadow:
              "0 4px 12px -2px var(--accent-purple-glow), inset 0 1px 0 rgba(255,255,255,0.25)",
            fontFamily: "var(--font-btn)",
          }}
        >
          ×{count}
        </span>
      )}
    </button>
  );
}

/**
 * Render slot — one visual tile in a deck column. We flatten the column's
 * groups into a sequence of slots:
 *   • Basic land groups collapse into a single slot with a count badge
 *     (so "Forest × 7" is one tile, not seven stacked copies).
 *   • Every other group expands one slot per pull, so duplicates stack
 *     with the Y-offset reveal that lets the user read each card's name.
 */
type RenderSlot =
  | { kind: "stacked"; pulled: PulledCard }
  | { kind: "collapsed"; pulled: PulledCard; count: number };

function buildColumnSlots(groups: PulledCard[][]): RenderSlot[] {
  const slots: RenderSlot[] = [];
  for (const g of groups) {
    if (g.length > 0 && isBasicLandUid(g[0].uid)) {
      slots.push({ kind: "collapsed", pulled: g[0], count: g.length });
    } else {
      for (const p of g) slots.push({ kind: "stacked", pulled: p });
    }
  }
  return slots;
}

function DeckColumn({
  bucket, groups, drag, handlers,
}: {
  bucket: ColumnId;
  groups: PulledCard[][];
  drag: DragState | null;
  handlers: SharedHandlers;
}) {
  const slots = buildColumnSlots(groups);
  const cardH = (DECK_CARD_W * 88) / 63;
  const stackH = cardH + Math.max(0, slots.length - 1) * DECK_STACK_OFFSET;
  const isPotentialTarget = drag?.active != null;
  // True card count includes the basic land multiples — slots may collapse
  // them but the header should still show the real total.
  const realCount = groups.reduce((s, g) => s + g.length, 0);
  const isEmpty = slots.length === 0;

  return (
    <div
      data-drop-zone="deck-column"
      data-column={String(bucket)}
      className="flex flex-col items-center shrink-0 rounded-lg transition-colors"
      style={{
        width: DECK_CARD_W + 10,
        background: isPotentialTarget ? "rgba(123, 57, 252, 0.04)" : undefined,
      }}
    >
      <div className="flex items-baseline justify-between w-full px-2 pb-1">
        <span
          className="label-caps text-[var(--accent-purple-light)]"
          style={{ fontFamily: "var(--font-ui)" }}
        >
          {bucketLabel(bucket)}
        </span>
        <span className="text-[10px] text-[var(--color-ink-muted)] tabular-nums">
          {realCount}
        </span>
      </div>
      <div
        className="relative"
        style={{ width: DECK_CARD_W, height: stackH || cardH }}
      >
        {isEmpty && drag?.active && (
          // Empty placeholder shown only while a drag is in progress. Lets
          // the column read as a valid drop target even though there's no
          // card in it yet — drop creates the column for real.
          <div
            className="absolute inset-0 rounded-xl border-2 border-dashed grid place-items-center text-[11px] text-[var(--color-ink-dim)]"
            style={{ borderColor: "rgba(164,132,215,0.30)" }}
          >
            Drop here
          </div>
        )}
        {slots.map((slot, i) => (
          <DeckSlotCard
            key={slot.pulled.uid}
            slot={slot}
            stackIndex={i}
            drag={drag}
            handlers={handlers}
          />
        ))}
      </div>
    </div>
  );
}

function DeckSlotCard({
  slot, stackIndex, drag, handlers,
}: {
  slot: RenderSlot;
  stackIndex: number;
  drag: DragState | null;
  handlers: SharedHandlers;
}) {
  const { pulled } = slot;
  const beingDragged = drag?.active && drag.uid === pulled.uid;
  const isCollapsed = slot.kind === "collapsed";
  const count = isCollapsed ? slot.count : 1;
  const isBasic = isBasicLandUid(pulled.uid);
  const aria = isBasic
    ? `${pulled.card.name} ×${count} — click to remove one`
    : `${pulled.card.name} — click to remove · drag to another column`;

  return (
    <button
      onPointerDown={(e) => handlers.startDrag(pulled, "deck", e)}
      onPointerMove={(e) => { handlers.moveDrag(e); handlers.armHover(pulled, e); }}
      onPointerUp={handlers.endDrag}
      onPointerCancel={handlers.cancelDrag}
      onPointerLeave={handlers.clearHover}
      className="absolute block focus:outline-none transition-transform hover:-translate-y-1 touch-none"
      style={{
        top: stackIndex * DECK_STACK_OFFSET,
        left: 0,
        width: DECK_CARD_W,
        zIndex: 50 + stackIndex,
        opacity: beingDragged ? 0.35 : 1,
      }}
      aria-label={aria}
    >
      <MagicCard
        card={{ kind: "scryfall", card: pulled.card, foil: false }}
        faceUp
        width={DECK_CARD_W}
        holoEnabled={false}
      />
      {isCollapsed && count > 1 && (
        <span
          className="absolute top-1 right-1 grid place-items-center rounded-full text-[12px] font-bold leading-none px-2 py-1 z-10"
          style={{
            background: "var(--accent-purple)",
            color: "white",
            boxShadow:
              "0 4px 12px -2px var(--accent-purple-glow), inset 0 1px 0 rgba(255,255,255,0.25)",
            fontFamily: "var(--font-btn)",
            minWidth: 32,
          }}
        >
          ×{count}
        </span>
      )}
    </button>
  );
}

/* ============================================================
   Hover preview + drag ghost (both fixed-position overlays)
   ============================================================ */

/**
 * Hover preview + drag ghost both render via React Portal directly onto
 * document.body. The deck/pool panels use `backdrop-filter`, which
 * creates a new containing block for `position: fixed` descendants — so a
 * preview rendered inside the panel would be clipped by the panel's
 * overflow even with z-index: 9999. Portaling escapes every stacking
 * context in the tree.
 */
function HoverPreview({
  card, foil, x, y,
}: { card: ScryfallCard; foil: boolean; x: number; y: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted || typeof document === "undefined") return null;

  const cardH = (PREVIEW_W * 88) / 63;
  const margin = 18;
  const offsetX = 24;
  let left = x + offsetX;
  let top = y - cardH / 2;
  if (left + PREVIEW_W + margin > window.innerWidth) left = x - PREVIEW_W - offsetX;
  if (top < margin) top = margin;
  if (top + cardH + margin > window.innerHeight) top = window.innerHeight - cardH - margin;

  return createPortal(
    <div
      className="fixed pointer-events-none anim-detail-fade"
      style={{ left, top, width: PREVIEW_W, zIndex: 2147483600 }}
    >
      <MagicCard
        card={{ kind: "scryfall", card, foil }}
        faceUp
        width={PREVIEW_W}
        holoEnabled={false}
      />
    </div>,
    document.body,
  );
}

function DragGhost({
  card, foil, x, y,
}: { card: ScryfallCard; foil: boolean; x: number; y: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted || typeof document === "undefined") return null;

  const W = 175;
  const cardH = (W * 88) / 63;
  return createPortal(
    <div
      className="fixed pointer-events-none"
      style={{
        left: x - W / 2,
        top: y - cardH / 2,
        width: W,
        transform: "rotateZ(-3deg)",
        filter: "drop-shadow(0 18px 30px rgba(0,0,0,0.55))",
        zIndex: 2147483647,
      }}
    >
      <MagicCard
        card={{ kind: "scryfall", card, foil }}
        faceUp
        width={W}
        holoEnabled={false}
      />
    </div>,
    document.body,
  );
}

/* ============================================================
   Chrome
   ============================================================ */

function DeckHeader({
  deckSize, deckMin, remaining, valid, onSortByMana, onExport,
}: {
  deckSize: number;
  deckMin: number;
  remaining: number;
  valid: boolean;
  onSortByMana: () => void;
  onExport: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 mb-5 rounded-2xl liquid-glass">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <p
          className="text-[15px] font-semibold tracking-wide text-[var(--color-fg)]"
          style={{ fontFamily: "var(--font-ui)" }}
        >
          Sealed deck builder
        </p>
        <div className="flex items-center gap-2">
          <span
            className="font-display text-2xl tabular-nums"
            style={{
              color: valid
                ? "var(--color-rarity-rare)"
                : "var(--color-fg)",
            }}
          >
            {deckSize}
          </span>
          <span className="text-[var(--color-ink-muted)] text-sm">/ {deckMin} min</span>
          {!valid && (
            <span className="text-[12px] text-[var(--color-rarity-mythic)] ml-2">
              {remaining} more card{remaining === 1 ? "" : "s"} needed
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onSortByMana}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[12px] font-medium tracking-wide transition-colors hover:bg-white/10 border border-[var(--color-line)]"
          style={{ color: "var(--color-ink)", fontFamily: "var(--font-ui)" }}
          aria-label="Sort deck cards into columns by mana value"
          title="Re-bin every deck card into its mana-value column"
        >
          <ArrowDownAZ className="w-3.5 h-3.5" />
          Sort by mana
        </button>
        <button
          onClick={onExport}
          disabled={!valid}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[14px] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: "var(--accent-purple)",
            color: "white",
            fontFamily: "var(--font-btn)",
            boxShadow:
              "0 8px 20px -8px var(--accent-purple-glow), inset 0 1px 0 rgba(255,255,255,0.18)",
          }}
        >
          <Download className="w-4 h-4" />
          Export deck
        </button>
      </div>
    </div>
  );
}

function PanelHeader({
  title, subtitle, countLabel, right,
}: {
  title: string;
  subtitle: string;
  countLabel: string;
  /** Optional slot rendered before the count label — used by the Pool
   *  panel to drop in its Sort by Mana / Sort by Color toggle. */
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3 px-5 py-3 border-b border-[var(--color-line)]">
      <div>
        <p
          className="label-caps text-[var(--accent-purple-light)]"
          style={{ fontFamily: "var(--font-ui)" }}
        >
          {title}
        </p>
        <p className="text-[12px] text-[var(--color-ink-muted)] mt-0.5">{subtitle}</p>
      </div>
      <div className="flex items-center gap-3">
        {right}
        <p
          className="text-[12px] text-[var(--color-ink)] tabular-nums"
          style={{ fontFamily: "var(--font-ui)" }}
        >
          {countLabel}
        </p>
      </div>
    </div>
  );
}

function PoolSortToggle({
  value, onChange,
}: { value: PoolSort; onChange: (v: PoolSort) => void }) {
  return (
    <div
      className="inline-flex items-center gap-0.5 p-0.5 rounded-full border border-[var(--color-line)]"
      style={{ fontFamily: "var(--font-ui)" }}
    >
      <SortPill
        active={value === "mana"}
        onClick={() => onChange("mana")}
        icon={<ArrowDownAZ className="w-3.5 h-3.5" />}
        label="Mana"
      />
      <SortPill
        active={value === "color"}
        onClick={() => onChange("color")}
        icon={<Palette className="w-3.5 h-3.5" />}
        label="Color"
      />
    </div>
  );
}

function SortPill({
  active, onClick, icon, label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium tracking-wide transition-colors"
      style={{
        background: active ? "var(--accent-purple)" : "transparent",
        color: active ? "white" : "var(--color-ink)",
      }}
      title={`Sort the pool by ${label.toLowerCase()}`}
    >
      {icon}
      {label}
    </button>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="px-5 py-10 text-center text-[var(--color-ink-muted)] text-sm">
      {message}
    </div>
  );
}

/** When the deck is empty, render a single drop zone covering the area so
 *  the player has somewhere to drop their first card. The card's default
 *  bucket determines which column it lands in. */
function EmptyDeckTarget() {
  return (
    <div
      data-drop-zone="deck"
      className="grid place-items-center text-[var(--color-ink-muted)] text-sm border-2 border-dashed rounded-xl"
      style={{
        minHeight: 280,
        borderColor: "var(--color-line)",
      }}
    >
      Drag a card here, or click any card in the pool to add it.
    </div>
  );
}

function BasicLandRow({
  lands, onBump,
}: {
  lands: BasicLandCounts;
  onBump: (name: keyof BasicLandCounts, delta: number) => void;
}) {
  return (
    <div className="rounded-2xl liquid-panel overflow-hidden">
      <PanelHeader
        title="Basic lands"
        subtitle="Add as many of each as you need — they don't come from your packs."
        countLabel={`${(Object.values(lands) as number[]).reduce((s, n) => s + n, 0)} lands`}
      />
      <div className="p-4 flex flex-wrap gap-2.5">
        {BASIC_LANDS.map((land) => {
          const count = lands[land.name];
          return (
            <div
              key={land.name}
              className="flex items-center gap-2 rounded-xl px-2.5 py-2 border"
              style={{
                borderColor: count > 0 ? land.color : "var(--color-line)",
                background:
                  count > 0
                    ? `linear-gradient(135deg, ${land.color}22, transparent)`
                    : "transparent",
                minWidth: 178,
              }}
            >
              <div
                className="grid place-items-center rounded-md text-[12px] font-bold shrink-0"
                style={{
                  width: 30, height: 30,
                  background: land.color, color: "#1a1a1a",
                }}
              >
                {land.symbol}
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className="text-[13px] font-semibold text-[var(--color-fg)] truncate"
                  style={{ fontFamily: "var(--font-ui)" }}
                >
                  {land.name}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => onBump(land.name, -1)}
                  disabled={count === 0}
                  className="grid place-items-center w-6 h-6 rounded-md disabled:opacity-30"
                  style={{ background: "rgba(255,255,255,0.06)" }}
                  aria-label={`Remove a ${land.name}`}
                >
                  <Minus className="w-3 h-3" />
                </button>
                <span
                  className="font-display text-base w-6 text-center tabular-nums"
                  style={{
                    color: count > 0 ? "var(--color-fg)" : "var(--color-ink-dim)",
                  }}
                >
                  {count}
                </span>
                <button
                  onClick={() => onBump(land.name, 1)}
                  className="grid place-items-center w-6 h-6 rounded-md"
                  style={{ background: "var(--accent-purple)", color: "white" }}
                  aria-label={`Add a ${land.name}`}
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   Export modal
   ============================================================ */

function ExportModal({
  deckCards, lands, basicLandSamples, setMeta, onClose,
}: {
  deckCards: ScryfallCard[];
  lands: BasicLandCounts;
  basicLandSamples: Partial<Record<string, ScryfallCard>>;
  setMeta: SetMeta;
  onClose: () => void;
}) {
  const text = useMemo(
    () => exportDeckText(deckCards, lands, basicLandSamples),
    [deckCards, lands, basicLandSamples],
  );
  const [copied, setCopied] = useState(false);

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      const ta = document.getElementById("export-textarea") as HTMLTextAreaElement | null;
      ta?.select();
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center anim-detail-fade"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        className="anim-detail-rise w-[min(640px,92vw)] max-h-[80vh] flex flex-col rounded-2xl liquid-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-line)]">
          <div>
            <p
              className="label-caps text-[var(--accent-purple-light)]"
              style={{ fontFamily: "var(--font-ui)" }}
            >
              Export · {setMeta.code.toUpperCase()} sealed
            </p>
            <p
              className="text-[14px] font-semibold text-[var(--color-fg)] mt-0.5"
              style={{ fontFamily: "var(--font-ui)" }}
            >
              Paste into MTGA, Untap, Moxfield, or any compatible client
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid place-items-center w-9 h-9 rounded-full hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <textarea
          id="export-textarea"
          value={text}
          readOnly
          spellCheck={false}
          className="flex-1 mx-5 my-4 p-4 rounded-lg bg-[var(--color-bg-soft)] border border-[var(--color-line)] text-[13px] leading-relaxed text-[var(--color-fg)] focus:outline-none resize-none"
          style={{ fontFamily: "var(--font-mono)", minHeight: 280 }}
        />
        <div className="px-5 pb-5 flex items-center justify-end gap-2">
          <button
            onClick={copyToClipboard}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[14px] font-medium transition-all"
            style={{
              background: copied ? "var(--color-rarity-rare)" : "var(--accent-purple)",
              color: copied ? "var(--color-bg)" : "white",
              fontFamily: "var(--font-btn)",
              boxShadow:
                "0 8px 20px -8px var(--accent-purple-glow), inset 0 1px 0 rgba(255,255,255,0.18)",
            }}
          >
            <Copy className="w-4 h-4" />
            {copied ? "Copied!" : "Copy to clipboard"}
          </button>
        </div>
      </div>
    </div>
  );
}
