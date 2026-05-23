"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, RotateCcw, Save, Eye, GripVertical, LayoutGrid, Layers } from "lucide-react";
import { getCardImage, getDisplayPrice } from "@/lib/scryfall";
import { PACKS, PACK_ORDER, getPackCost, type PackType } from "@/lib/pack-rules";
import { preloadImages } from "@/lib/preload";
import type { PackContent } from "@/lib/booster-config";
import type { FilterPredicate } from "@/lib/booster-filters";
import { openPack, type CardPool, type PulledCard } from "@/lib/pack-open";
import { addToCollection } from "@/lib/collection";
import { useDragReorder } from "@/lib/useDragReorder";
import { useCardTilt } from "@/lib/useCardTilt";
import { MagicCard } from "@/app/_components/MagicCard";
import { CardDetailModal } from "@/app/_components/CardDetailModal";
import { CardDeck } from "./CardDeck";

type ViewMode = "reveal" | "grid";

interface SetMeta {
  code: string;
  name: string;
  iconUri?: string;
  /** Art-crop URLs from notable rares/mythics in this set — used as the
   *  page's branding decor. The first one drives the panel backdrop. */
  heroArtCrops?: string[];
}

interface Props {
  setMeta: SetMeta;
  /** Multi-set card pool keyed by lowercased Scryfall code. Includes the
   *  main set, any subset referenced by a recipe (e.g. SOA for SOS), plus
   *  the conventional t<code> tokens set. */
  pool: CardPool;
  /** Resolved pack contents per type. Provided by the route layer after
   *  consulting data/sets/<code>.json + data/booster-contents/*. */
  recipes: Partial<Record<PackType, PackContent>>;
  /** Per-pack-type MSRP override resolved at the route layer. Falls back
   *  to getPackCost when missing. */
  costs: Partial<Record<PackType, number>>;
  filters: Record<string, FilterPredicate>;
  availableTypes: PackType[];
  initialType: PackType;
}

type Phase = "idle" | "ripping" | "revealing";

export function PackOpener({
  setMeta, pool, recipes, costs, filters, availableTypes, initialType,
}: Props) {
  const [packType, setPackType] = useState<PackType>(initialType);
  const [phase, setPhase] = useState<Phase>("idle");
  const [pulled, setPulled] = useState<PulledCard[]>([]);
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>("reveal");
  const [detailUid, setDetailUid] = useState<string | null>(null);
  // Session-level money tracker — resets on full page reload.
  const [stats, setStats] = useState<{ spent: number; pulled: number; packs: number }>({
    spent: 0,
    pulled: 0,
    packs: 0,
  });
  /** uids whose price has already been added to `stats.pulled` for the
   *  current pack. Stored in a ref so updating it (called from CardDeck's
   *  init effect for the first card) never schedules a React state update
   *  during another component's render. */
  const valuedRef = useRef<Set<string>>(new Set());

  // The currently-selected pack type's MSRP. The route layer resolves per-set
  // overrides (data/sets/<code>.json cost field) up front; we fall back to the
  // legacy synchronous override map only if the route layer didn't supply one.
  const packCost = costs[packType] ?? getPackCost(packType, setMeta.code);

  /**
   * Open a pack. `typeOverride` lets callers (notably the fan click handler
   * and the MoneyStrip's "Open next" button) pass the clicked pack type
   * directly — necessary because `setPackType` is async and the previous
   * `packType` state would otherwise be read here.
   *
   * Phase guard: only blocks during the 800ms "ripping" animation. Mid-
   * reveal rips are allowed — the MoneyStrip button uses this path to
   * chain-open more of the same type without going back to the fan.
   */
  function rip(typeOverride?: PackType) {
    if (phase === "ripping") return;
    const t = typeOverride ?? packType;
    const recipe = recipes[t];
    if (!recipe) return; // shouldn't happen — route layer filtered availableTypes
    setPhase("ripping");
    const result = openPack(recipe, pool, setMeta.code, filters);
    setPulled(result);
    setFlipped(new Set());
    valuedRef.current = new Set();
    setDetailUid(null);
    setViewMode("reveal");
    // Use the just-clicked type for the cost so the MoneyStrip doesn't
    // lag a pack behind.
    const costForThisPack = costs[t] ?? getPackCost(t, setMeta.code);
    setStats((s) => ({
      ...s,
      spent: s.spent + costForThisPack,
      packs: s.packs + 1,
    }));
    // Cinematic rip choreography runs ~1300ms (see RippingPack +
    // .anim-pack-* keyframes in globals.css). In parallel, kick off
    // image preloads for every pulled card's front face so the reveal
    // can't be spoiled by a lower-stack card painting before the
    // top — the new <img> elements rendered by MagicCard hit the
    // browser cache instead of triggering a fresh network fetch.
    //
    // Default reveal is the CardDeck (faceUp at width 240 mobile / 320
    // desktop, both of which map to the "large" JPEG variant). We
    // preload `large`; if a card later uses `normal` (smaller render in
    // grid view) it'll fetch on demand — fine since the reveal is
    // already underway by then.
    const ripTimer = new Promise<void>((resolve) => {
      window.setTimeout(resolve, 1300);
    });
    const urls = result.map(
      (p) =>
        getCardImage(p.card, "large") ??
        getCardImage(p.card, "normal") ??
        p.card.card_faces?.[0]?.image_uris?.large ??
        p.card.card_faces?.[0]?.image_uris?.normal,
    );
    Promise.all([ripTimer, preloadImages(urls)]).then(() => {
      setPhase("revealing");
    });
  }

  function reset() {
    setPhase("idle");
    setPulled([]);
    setFlipped(new Set());
    valuedRef.current = new Set();
    setDetailUid(null);
  }

  /** Idempotent — adds the card's market price to `stats.pulled` the first
   *  time it's revealed. Safe to call from any phase (including from a
   *  child component's render path) because the React state update is
   *  deferred to a microtask. */
  function markRevealed(uid: string) {
    if (valuedRef.current.has(uid)) return;
    const p = pulled.find((x) => x.uid === uid);
    if (!p) return;
    valuedRef.current.add(uid);
    const price = getDisplayPrice(p.card, p.foil);
    if (!price) return;
    // queueMicrotask defers the setState past the current render commit so
    // CardDeck's init effect can call us without triggering React's
    // "Cannot update a component while rendering a different component"
    // warning.
    queueMicrotask(() => {
      setStats((s) => ({ ...s, pulled: s.pulled + price.value }));
    });
  }

  /** Fired when Reveal mode finishes — auto-flip every card in Grid with a
   *  small stagger so the transition reads as a smooth fan-out. */
  function autoFlipAll() {
    pulled.forEach((p, i) => {
      window.setTimeout(() => {
        setFlipped((prev) => {
          if (prev.has(p.uid)) return prev;
          const next = new Set(prev);
          next.add(p.uid);
          return next;
        });
        // Defensive: cards have already been priced during reveal, but
        // call markRevealed here too for the manual-switch case.
        markRevealed(p.uid);
      }, 120 + i * 110);
    });
  }

  /** Click handler used by both Grid and Reveal modes.
   *  - Grid + face-down → flip it
   *  - Grid + face-up   → open the detail modal
   *  - Reveal (top)     → open the detail modal */
  function onTapCard(uid: string) {
    if (viewMode === "reveal") {
      setDetailUid(uid);
      return;
    }
    if (flipped.has(uid)) setDetailUid(uid);
    else flipOne(uid);
  }

  const detailPulled =
    detailUid ? pulled.find((p) => p.uid === detailUid) ?? null : null;

  function flipAll() {
    setFlipped(new Set(pulled.map((p) => p.uid)));
    pulled.forEach((p) => markRevealed(p.uid));
  }

  function flipOne(uid: string) {
    setFlipped((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) {
        next.delete(uid);
      } else {
        next.add(uid);
        // Count price the first time a card flips face-up.
        markRevealed(uid);
      }
      return next;
    });
  }

  function saveAll() {
    addToCollection(
      pulled.map((p) => ({
        cardId: p.card.id,
        name: p.card.name,
        rarity: p.card.rarity,
        setCode: p.card.set,
        setName: p.card.set_name,
        collectorNumber: p.card.collector_number,
        image:
          getCardImage(p.card, "art_crop") ??
          getCardImage(p.card, "normal") ??
          "",
        foil: p.foil,
        pulledAt: Date.now(),
      })),
    );
    reset();
  }

  function reorder(from: number, to: number) {
    setPulled((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  const heroArt = setMeta.heroArtCrops?.[0];

  return (
    <section className="mx-auto max-w-7xl w-full px-3 sm:px-6 py-6 sm:py-10">
      <MoneyStrip
        stats={stats}
        packCost={packCost}
        packTypeName={PACKS[packType].name.replace(" Booster", "")}
        canRip={phase !== "ripping" && !!recipes[packType]}
        onRip={() => rip(packType)}
      />
      <div className="relative rounded-2xl liquid-panel overflow-hidden">
        {/* Per-set art backdrop — a faded, heavily-blurred art crop from a
            top card of the set sits behind everything else, giving each
            set its own visual identity without competing with the cards. */}
        {heroArt && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroArt}
            alt=""
            aria-hidden
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            style={{
              opacity: 0.008,
              filter: "blur(40px) saturate(80%)",
              transform: "scale(1)",
            }}
          />
        )}
        <div className="relative">
        <div
          data-deck-canvas
          className="relative min-h-[560px] sm:min-h-[680px] flex flex-col items-center justify-center px-3 sm:px-6 py-6 sm:py-10 overflow-hidden"
          style={{ isolation: "isolate" }}
        >
          {/* Card-shaped backdrop glow. A heavily-blurred rectangle in
              the same 63:88 portrait ratio as a card sits centered behind
              the content, in a brighter desaturated purple that reads as
              an extension of the site's purple palette rather than a
              second accent color. The dark purple base shows through from
              the liquid-panel + page bg behind.

              `isolation: isolate` on the canvas establishes a stacking
              context so the glow's `z-index: -1` keeps it behind the
              flex-children content but still inside the canvas — without
              the isolation it would escape behind the liquid-panel's
              own background and disappear. */}
          <div
            aria-hidden
            className="absolute pointer-events-none"
            style={{
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "clamp(280px, 42%, 460px)",
              aspectRatio: "63 / 88",
              borderRadius: "28px",
              background: "#f5f5f5",
              filter: "blur(90px)",
              opacity: 0.05,
              zIndex: -1,
            }}
          />
          {phase === "idle" && (
            <div className="flex flex-col items-center gap-8 w-full">
              {/* Headline sits above the fan via z-index — fanned packs lift
                  on hover and would otherwise overlap the text. */}
              <div className="text-center relative" style={{ zIndex: 20 }}>
                <p className="label-caps text-[var(--color-ink-muted)] mb-2">{setMeta.name}</p>
                <h2 className="font-display text-3xl md:text-4xl text-[var(--color-fg)]">
                  Open a new pack
                </h2>
              </div>
              <PackFan
                available={availableTypes}
                setMeta={setMeta}
                onSelect={(t) => { setPackType(t); rip(t); }}
              />
            </div>
          )}

          {phase === "ripping" && (
            <RippingPack setMeta={setMeta} packType={packType} />
          )}

          {phase === "revealing" && viewMode === "grid" && (
            <CardSpread
              pulled={pulled}
              flipped={flipped}
              onTap={onTapCard}
              onReorder={reorder}
            />
          )}

          {phase === "revealing" && viewMode === "reveal" && (
            <CardDeck
              pulled={pulled}
              onCardSeen={markRevealed}
              onAllRevealed={() => {
                setViewMode("grid");
                autoFlipAll();
              }}
            />
          )}
        </div>

        {phase === "revealing" && (
          <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between border-t border-[var(--color-line)] px-4 sm:px-6 py-3 sm:py-4">
            <div className="flex flex-col md:flex-row gap-3 md:items-center">
              <PullSummary pulled={pulled} />
              <ViewToggle mode={viewMode} onChange={setViewMode} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={flipAll}
                className="inline-flex items-center gap-2 label-caps px-4 py-2.5 rounded-full btn-hero-secondary liquid-glass"
              >
                <Eye className="w-3.5 h-3.5" /> Reveal all
              </button>
              <button
                onClick={saveAll}
                className="inline-flex items-center gap-2 label-caps px-4 py-2.5 rounded-full bg-white text-[var(--color-bg)] hover:bg-white/90 transition-colors"
              >
                <Save className="w-3.5 h-3.5" /> Save to binder
              </button>
              <button
                onClick={reset}
                className="inline-flex items-center gap-2 label-caps px-4 py-2.5 rounded-full btn-hero-secondary liquid-glass"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Open another
              </button>
            </div>
          </div>
        )}
        </div>
      </div>

      <CardDetailModal
        card={detailPulled?.card ?? null}
        foil={detailPulled?.foil}
        slotLabel={detailPulled?.slotLabel}
        onClose={() => setDetailUid(null)}
      />
    </section>
  );
}

/* ---------------- Session money strip ---------------- */

function MoneyStrip({
  stats, packCost, packTypeName, canRip, onRip,
}: {
  stats: { spent: number; pulled: number; packs: number };
  packCost: number;
  /** Short type label shown on the rip button (e.g. "Play", "Collector"). */
  packTypeName: string;
  /** Disables the button during the 800ms ripping animation. */
  canRip: boolean;
  onRip: () => void;
}) {
  const profit = stats.pulled - stats.spent;
  const profitSign = profit >= 0 ? "+" : "-";
  const profitColor = profit >= 0
    ? "text-[var(--color-rarity-rare)]"
    : "text-[var(--color-rarity-mythic)]";
  const usd = (n: number) => `$${n.toFixed(2)}`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 mb-4 rounded-2xl liquid-glass">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Stat label="Pulled" value={usd(stats.pulled)} accent="text-[var(--color-fg)]" />
        <Stat label="Spent"  value={usd(stats.spent)} accent="text-[var(--color-ink-muted)]" />
        <Stat
          label={profit >= 0 ? "Profit" : "Loss"}
          value={`${profitSign}${usd(Math.abs(profit))}`}
          accent={profitColor}
        />
        <Stat label="Packs" value={String(stats.packs)} accent="text-[var(--color-fg)]" />
      </div>
      {/* "Open next" — rips another pack of the currently-selected type
          without going back to the fan. Active in idle + revealing phases;
          disabled only during the 800ms ripping animation to prevent
          double-fires. Replaces the static "next pack · $X" label. */}
      <button
        onClick={onRip}
        disabled={!canRip}
        className="group inline-flex items-center gap-2 pl-3 pr-4 py-2 rounded-full transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          background: "var(--accent-purple)",
          color: "white",
          fontFamily: "var(--font-btn)",
          boxShadow: "0 8px 20px -8px var(--accent-purple-glow), inset 0 1px 0 rgba(255,255,255,0.18)",
        }}
        aria-label={`Open another ${packTypeName} Booster for ${usd(packCost)}`}
      >
        <span
          className="grid place-items-center w-6 h-6 rounded-full text-[10px] font-bold tracking-wider uppercase"
          style={{ background: "rgba(255,255,255,0.18)" }}
        >
          +1
        </span>
        <span className="text-[13px] font-medium tracking-wide">
          Open next {packTypeName}
        </span>
        <span className="text-[13px] font-semibold tabular-nums opacity-90">
          {usd(packCost)}
        </span>
      </button>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="flex flex-col">
      <span className="label-caps text-[var(--color-ink-muted)]/80">{label}</span>
      <span className={`font-display text-xl ${accent}`}>{value}</span>
    </div>
  );
}

/* ---------------- Pack type bar ---------------- */

function PackTypeBar({
  available, current, onChange, disabled,
}: {
  available: PackType[];
  current: PackType;
  onChange: (t: PackType) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-6 py-4 border-b border-[var(--color-line)]">
      <p className="label-caps text-[var(--color-ink-muted)]">Pack type</p>
      <div className="flex flex-wrap gap-1 p-1 rounded-full liquid-glass">
        {PACK_ORDER.filter((t) => available.includes(t)).map((t) => {
          const active = t === current;
          return (
            <button
              key={t}
              disabled={disabled && !active}
              onClick={() => onChange(t)}
              className={`text-xs font-semibold tracking-wider uppercase px-4 py-2 rounded-full transition-colors ${
                active
                  ? "bg-white text-[var(--color-bg)]"
                  : "text-[var(--color-fg)] hover:bg-white/10"
              } ${disabled && !active ? "opacity-40 cursor-not-allowed" : ""}`}
            >
              {PACKS[t].name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Pack fan (idle phase) ---------------- */

/**
 * `matchMedia` listener that returns true when the viewport is narrower
 * than the Tailwind `sm` breakpoint (640px). Used by PackFan to switch
 * from the static fan layout (desktop) to a swipeable carousel (mobile).
 * Initialises to `false` for SSR safety; the first browser frame syncs it.
 */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 639px)");
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}

function PackFan({
  available, setMeta, onSelect,
}: {
  available: PackType[];
  setMeta: SetMeta;
  onSelect: (t: PackType) => void;
}) {
  // Play sits in the middle of the fan when available; the other packs
  // distribute around it. Falls back to PACK_ORDER for sets without play.
  const ordered = (() => {
    const filtered = PACK_ORDER.filter((t) => available.includes(t));
    if (!filtered.includes("play")) return filtered;
    const others = filtered.filter((t) => t !== "play");
    const mid = Math.floor(others.length / 2);
    return [...others.slice(0, mid), "play" as PackType, ...others.slice(mid)];
  })();
  const centerIdx = Math.floor(ordered.length / 2);
  const isMobile = useIsMobile();
  // Selected pack type for the mobile single-pack view. Defaults to
  // whichever pack the fan would put at center (Play if available).
  const [mobilePick, setMobilePick] = useState<PackType>(ordered[centerIdx] ?? ordered[0]);
  // If `available` changes (e.g. set page swap), make sure the selection
  // still points at a valid type.
  useEffect(() => {
    if (!ordered.includes(mobilePick)) {
      setMobilePick(ordered[centerIdx] ?? ordered[0]);
    }
  }, [ordered, mobilePick, centerIdx]);

  // Mobile: a single centered pack with a pack-type chip selector above
  // it. Replaces the earlier horizontal scroll-snap carousel — that
  // pattern put the side packs off-screen and made tap-vs-swipe
  // detection unreliable, since a slight finger drift on tap was being
  // interpreted as a scroll attempt. With one centered pack the whole
  // tap target is in view and unambiguous.
  if (isMobile) {
    return (
      <div className="w-full flex flex-col items-center gap-5">
        {ordered.length > 1 && (
          <div
            className="flex flex-wrap gap-1 p-1 rounded-full liquid-glass"
            style={{ fontFamily: "var(--font-ui)" }}
          >
            {ordered.map((type) => {
              const active = type === mobilePick;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setMobilePick(type)}
                  aria-pressed={active}
                  className={`text-xs px-3.5 py-1.5 rounded-full font-medium transition-colors ${
                    active
                      ? "text-white"
                      : "text-[var(--color-ink)] hover:text-white"
                  }`}
                  style={active ? { background: "var(--accent-purple)" } : undefined}
                >
                  {PACKS[type].name.replace(" Booster", "")}
                </button>
              );
            })}
          </div>
        )}
        <FannedPack
          key={mobilePick}
          packType={mobilePick}
          setMeta={setMeta}
          offset={0}
          isCenter
          onSelect={() => onSelect(mobilePick)}
          artIndex={ordered.indexOf(mobilePick)}
          compact
        />
      </div>
    );
  }

  return (
    <div className="flex items-end justify-center gap-6 md:gap-8 w-full">
      {ordered.map((type, i) => {
        const offset = i - centerIdx;
        const isCenter = offset === 0;
        return (
          <FannedPack
            key={type}
            packType={type}
            setMeta={setMeta}
            offset={offset}
            isCenter={isCenter}
            onSelect={() => onSelect(type)}
            artIndex={i}
          />
        );
      })}
    </div>
  );
}

function FannedPack({
  packType, setMeta, offset, isCenter, onSelect, artIndex, compact = false,
}: {
  packType: PackType;
  setMeta: SetMeta;
  offset: number;
  isCenter: boolean;
  onSelect: () => void;
  artIndex: number;
  /** Mobile layout — drops the fan rotation and shrinks the pack so it
   *  fits inside a phone viewport with room for swipe gestures. */
  compact?: boolean;
}) {
  const c = packHue(packType);
  // Static fan-pose rotation (applied to the outer button so the whole pack
  // leans outward). The inner body owns the cursor-driven 3D tilt.
  // Compact (mobile) layout: pack sits upright, no offset lift, no scale
  // bump — the swipe carousel needs every pack to share the same baseline.
  const fanRot = compact ? 0 : offset * 7;
  const lift = compact ? 0 : isCenter ? -18 : 0;
  const scale = compact ? 1 : isCenter ? 1.04 : 1;
  // Cursor-driven parallax: bigger tilt on the center pack since it's the
  // hero pose, slightly subdued on the side packs so the wobble doesn't
  // amplify the existing fan rotation.
  const tilt = useCardTilt({ maxTilt: isCenter ? 14 : 10, glare: true });
  // Pick a different art crop per pack so each pack reads as distinct.
  const heroArt = setMeta.heroArtCrops?.[artIndex % (setMeta.heroArtCrops.length || 1)];

  // Real Magic booster aspect is roughly 1 : 1.46 after widening. We use
  // 260 × 380 px (~30% wider than the original 200 × 380 silhouette so the
  // art crop reads at a comfortable size). Compact mode (mobile) drops to
  // ~210 × 308 so the carousel snaps comfortably inside a 375px viewport
  // while keeping the same 1:1.46 silhouette.
  const PACK_W = compact ? 210 : 260;
  const PACK_H = compact ? 308 : 380;

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        onClick={onSelect}
        aria-label={`Open ${PACKS[packType].name}`}
        className="relative outline-none cursor-pointer transition-transform duration-300"
        style={{
          transform: `rotate(${fanRot}deg) translateY(${lift}px) scale(${scale})`,
          transformOrigin: "center bottom",
          transformStyle: "preserve-3d",
          perspective: "1100px",
          zIndex: isCenter ? 10 : 5,
        }}
      >
        <div
          ref={tilt.ref}
          onPointerEnter={tilt.onPointerEnter}
          onPointerMove={tilt.onPointerMove}
          onPointerLeave={tilt.onPointerLeave}
          className="pack-tilt relative overflow-hidden"
          style={{
            width: PACK_W,
            height: PACK_H,
            borderRadius: "14px 14px 6px 6px",
            background: `linear-gradient(160deg, ${c.from} 0%, ${c.to} 100%)`,
            border: `1px solid ${c.edge}`,
            boxShadow: isCenter
              ? `0 50px 90px -30px rgba(0,0,0,0.65), 0 20px 50px -20px ${c.from}80`
              : `0 30px 70px -30px rgba(0,0,0,0.55)`,
          }}
        >
          {/* Art-crop background — half a stop lighter so the artwork
              reads through the color wash without losing legibility. */}
          {heroArt && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={heroArt}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              style={{ filter: "brightness(0.55) saturate(0.95) contrast(1.10)" }}
            />
          )}
          {/* Color wash to lock pack identity (lighter alpha so the art
              isn't overwhelmed). */}
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(160deg, ${c.from}A0 0%, ${c.to}C0 100%)`,
              mixBlendMode: "multiply",
            }}
          />
          {/* Inner border */}
          <div className="absolute inset-3 rounded-md border border-white/10 pointer-events-none" />

          {/* Tear strip + foil notch at top — mimics a real booster's
              perforated top edge. */}
          <div className="absolute top-0 inset-x-0 h-6 bg-black/40 flex items-center justify-center gap-1">
            {Array.from({ length: 12 }).map((_, i) => (
              <span
                key={i}
                className="w-1.5 h-1 rounded-sm bg-white/30"
              />
            ))}
          </div>



          {/* Set icon */}
          <div className="absolute inset-x-0 top-24 grid place-items-center">
            {setMeta.iconUri && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={setMeta.iconUri}
                alt=""
                className="w-20 h-20 object-contain"
                style={{ filter: "brightness(0) invert(1) drop-shadow(0 6px 18px rgba(0,0,0,0.5))" }}
              />
            )}
          </div>

          {/* Set name + pack-type label near the bottom */}
          <div className="absolute bottom-10 inset-x-3 text-center px-2">
            <p className="font-display text-white text-base tracking-wide leading-tight">
              {setMeta.name}
            </p>
            <p className="text-[9px] tracking-[0.3em] uppercase font-medium text-white/65 mt-2">
              {setMeta.code.toUpperCase()} · {PACKS[packType].name}
            </p>
          </div>

          {/* Diagonal foil shimmer band */}
          <div
            className="absolute inset-y-0 left-0 right-0 pointer-events-none"
            style={{
              background:
                "linear-gradient(115deg, transparent 35%, rgba(255,255,255,0.20) 50%, transparent 65%)",
              mixBlendMode: "screen",
            }}
          />
          {/* Cursor-tracked glare — driven by --glare-x/--glare-y on the
              tilting wrapper (see globals.css → .pack-glare). */}
          <div className="pack-glare" />
        </div>
      </button>

      {/* Rip button below — stays upright (no rotation) */}
      <button
        onClick={onSelect}
        className={`btn-hero-secondary liquid-glass rounded-full text-sm font-semibold px-5 py-2.5 ${
          isCenter ? "scale-105" : ""
        }`}
      >
        Rip {PACKS[packType].name.replace(" Booster", "")}
      </button>
    </div>
  );
}

/* ---------------- Pack visuals ---------------- */

function packHue(packType: PackType) {
  switch (packType) {
    case "play":      return { from: "#3b1d6e", to: "#1a0a3b", edge: "#0a0420" };
    case "draft":     return { from: "#1e3a8a", to: "#0a193b", edge: "#04081d" };
    case "collector": return { from: "#7e1d6e", to: "#330b3b", edge: "#1d0420" };
  }
}

function BoosterPack({
  setMeta, onClick, packType,
}: {
  setMeta: SetMeta;
  onClick?: () => void;
  packType: PackType;
}) {
  const c = packHue(packType);
  return (
    <button
      onClick={onClick}
      className="relative outline-none cursor-pointer transition-transform duration-300 hover:scale-[1.02]"
      style={{ width: 260, height: 380 }}
      aria-label={`Open ${PACKS[packType].name}`}
    >
      <div
        className="w-full h-full relative rounded-xl overflow-hidden shadow-[0_50px_100px_-40px_rgba(168,85,247,0.45)]"
        style={{
          background: `linear-gradient(160deg, ${c.from} 0%, ${c.to} 100%)`,
          border: `1px solid ${c.edge}`,
        }}
      >
        <div className="absolute inset-3 rounded-lg border border-white/12" />
        <div className="absolute inset-x-0 top-10 text-center font-display text-white text-3xl tracking-[0.3em] opacity-95">
          MAGIC
        </div>
        <div className="absolute inset-x-0 top-20 text-center text-[10px] font-medium tracking-[0.4em] uppercase text-white/70">
          THE GATHERING
        </div>
        <div className="absolute inset-x-0 top-40 grid place-items-center">
          {setMeta.iconUri && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={setMeta.iconUri}
              alt=""
              className="w-24 h-24 object-contain"
              style={{ filter: "brightness(0) invert(1) drop-shadow(0 6px 20px rgba(168,85,247,0.5))" }}
            />
          )}
        </div>
        <div className="absolute inset-x-0 bottom-12 text-center px-4">
          <p className="font-display text-white text-2xl tracking-wider leading-tight">
            {setMeta.name}
          </p>
          <p className="text-[10px] tracking-[0.3em] uppercase font-medium text-white/65 mt-2">
            {setMeta.code.toUpperCase()} · {PACKS[packType].name}
          </p>
        </div>
        <div
          className="absolute inset-y-0 left-0 right-0 pointer-events-none"
          style={{
            background:
              "linear-gradient(115deg, transparent 35%, rgba(255,255,255,0.30) 50%, transparent 65%)",
            mixBlendMode: "screen",
          }}
        />
        <div className="absolute top-3 right-3 w-6 h-2 rounded-sm bg-white/30" />
      </div>
    </button>
  );
}

/**
 * Cinematic pack rip — anticipation wobble → top tear strip flies off →
 * seam splits open with a flash → light shaft erupts vertically while
 * five card silhouettes burst out in a fan with sparkles → pack body
 * fades to give way to the reveal. Total duration ~1300ms.
 *
 * The static pack visual mirrors `FannedPack` (set art crop, color wash,
 * tear-strip perforation, set icon, name + booster label) so the rip
 * looks like the same pack the user just tapped, not a swapped-in flat
 * rectangle.
 */
function RippingPack({ setMeta, packType }: { setMeta: SetMeta; packType: PackType }) {
  const c = packHue(packType);
  const isMobile = useIsMobile();
  const W = isMobile ? 210 : 260;
  const H = isMobile ? 308 : 380;
  // Reuse the same hero art crop the FannedPack used so the rip feels
  // continuous with the tap.
  const heroArt = setMeta.heroArtCrops?.[0];

  // Five card silhouettes fanning out of the pack. Pre-computed offsets:
  // outermost cards travel further horizontally and rotate more.
  const silhouettes = [
    { x: -200, rot: -32, delay: 380 },
    { x: -100, rot: -18, delay: 420 },
    { x:    0, rot:   0, delay: 460 },
    { x:  100, rot:  18, delay: 500 },
    { x:  200, rot:  32, delay: 540 },
  ];

  // Scatter of sparkle particles around the top opening. Travel distances
  // capped so sparkles stay inside the reveal canvas's overflow-hidden box
  // (~130px headroom above the pack on mobile, more on desktop).
  const sparkles = [
    { x: -100, y: -110, delay: 360, size: 5 },
    { x:  -60, y: -135, delay: 400, size: 4 },
    { x:  -25, y: -150, delay: 460, size: 6 },
    { x:   25, y: -145, delay: 500, size: 4 },
    { x:   70, y: -125, delay: 380, size: 5 },
    { x:  115, y: -100, delay: 440, size: 4 },
    { x: -125, y:  -70, delay: 520, size: 3 },
    { x:  130, y:  -65, delay: 560, size: 3 },
  ];

  return (
    <div
      className="relative"
      style={{
        width: W,
        height: H,
        perspective: 1400,
        // Headroom for sparkles + silhouettes to fly out the top without
        // being clipped by the parent canvas's overflow-hidden — we lean
        // on the canvas being relatively tall.
      }}
    >
      {/* Outer wobble wrapper — provides the 200ms anticipation shake. */}
      <div className="anim-pack-wobble absolute inset-0">
        {/* Inner fade wrapper — the actual pack body that fades out to
            cede to the card reveal at the end of the rip. */}
        <div
          className="anim-pack-body-fade absolute inset-0 overflow-hidden"
          style={{
            borderRadius: "14px 14px 6px 6px",
            background: `linear-gradient(160deg, ${c.from} 0%, ${c.to} 100%)`,
            border: `1px solid ${c.edge}`,
            boxShadow: `0 50px 90px -30px rgba(0,0,0,0.65), 0 20px 50px -20px ${c.from}80`,
          }}
        >
          {/* Art-crop background — same as FannedPack. */}
          {heroArt && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={heroArt}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              style={{ filter: "brightness(0.55) saturate(0.95) contrast(1.10)" }}
            />
          )}
          {/* Color wash to lock pack identity. */}
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(160deg, ${c.from}A0 0%, ${c.to}C0 100%)`,
              mixBlendMode: "multiply",
            }}
          />
          {/* Inner border */}
          <div className="absolute inset-3 rounded-md border border-white/10 pointer-events-none" />

          {/* Set icon (matches FannedPack position). */}
          <div className="absolute inset-x-0 top-24 grid place-items-center">
            {setMeta.iconUri && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={setMeta.iconUri}
                alt=""
                className="w-20 h-20 object-contain"
                style={{ filter: "brightness(0) invert(1) drop-shadow(0 6px 18px rgba(0,0,0,0.5))" }}
              />
            )}
          </div>

          {/* Set name + pack-type label near the bottom. */}
          <div className="absolute bottom-10 inset-x-3 text-center px-2">
            <p className="font-display text-white text-base tracking-wide leading-tight">
              {setMeta.name}
            </p>
            <p className="text-[9px] tracking-[0.3em] uppercase font-medium text-white/65 mt-2">
              {setMeta.code.toUpperCase()} · {PACKS[packType].name}
            </p>
          </div>

          {/* Bright seam revealed when the tear strip flies off. Sits
              right under where the strip was. Stays in place while the
              strip animates away above it. */}
          <div
            className="anim-pack-seam absolute left-0 right-0"
            style={{
              top: 18,
              height: 6,
              background:
                "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.95) 20%, rgba(255,255,255,1) 50%, rgba(255,255,255,0.95) 80%, rgba(255,255,255,0) 100%)",
              filter: "blur(2px)",
              transformOrigin: "left center",
            }}
          />
        </div>
      </div>

      {/* Tear strip — sits at the top of the pack initially, then flies
          off to the upper right. Drawn OUTSIDE the body-fade wrapper so
          it doesn't share the body's fade timing; it animates entirely
          via its own keyframe. */}
      <div
        className="anim-tear-strip absolute top-0 left-0 right-0 h-6 overflow-hidden"
        style={{
          background: "rgba(0,0,0,0.5)",
          borderRadius: "14px 14px 0 0",
        }}
      >
        {/* Perforation dots that gave the FannedPack its booster look. */}
        <div className="absolute inset-0 flex items-center justify-center gap-1">
          {Array.from({ length: 12 }).map((_, i) => (
            <span key={i} className="w-1.5 h-1 rounded-sm bg-white/30" />
          ))}
        </div>
      </div>

      {/* Vertical light shaft erupting from the open top. Anchored
          bottom-center so scaleY grows upward. Slightly wider than the
          tear gap so it reads as escaping light, not a laser. */}
      <div
        className="anim-light-shaft pointer-events-none absolute"
        style={{
          left: "50%",
          bottom: "100%",
          width: W * 0.55,
          height: H * 1.4,
          marginBottom: 6,
          background:
            "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,240,200,0.85) 30%, rgba(255,255,255,0.95) 60%, rgba(168,132,255,0.8) 90%, transparent 100%)",
          filter: "blur(8px)",
          mixBlendMode: "screen",
        }}
      />

      {/* Burst flash — radial glow from the top of the pack right as
          the seam splits. */}
      <div
        className="anim-burst-flash pointer-events-none absolute"
        style={{
          left: "50%",
          top: 0,
          transform: "translate(-50%, -20%)",
          width: W * 1.4,
          height: W * 1.4,
          background:
            "radial-gradient(circle at 50% 50%, rgba(255,255,255,1) 0%, rgba(255,220,150,0.85) 25%, rgba(168,132,255,0.6) 50%, transparent 75%)",
          filter: "blur(4px)",
          mixBlendMode: "screen",
          transformOrigin: "center",
        }}
      />

      {/* Card silhouettes flying out of the pack in a fan. */}
      {silhouettes.map((s, i) => (
        <div
          key={i}
          className="anim-card-silhouette pointer-events-none absolute"
          style={{
            left: "50%",
            top: 0,
            width: 70,
            height: Math.round(70 * 88 / 63),
            borderRadius: 4,
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(220,210,255,0.85) 60%, rgba(180,160,235,0.75) 100%)",
            boxShadow:
              "0 0 24px rgba(255,255,255,0.7), 0 0 40px rgba(168,132,255,0.55)",
            ["--silhouette-x" as string]: `${s.x}px`,
            ["--silhouette-rot" as string]: `${s.rot}deg`,
            animationDelay: `${s.delay}ms`,
            transformOrigin: "center bottom",
          }}
        />
      ))}

      {/* Sparkle particles. */}
      {sparkles.map((s, i) => (
        <div
          key={`sp-${i}`}
          className="anim-pack-sparkle pointer-events-none absolute"
          style={{
            left: "50%",
            top: 0,
            width: s.size,
            height: s.size,
            borderRadius: "50%",
            background: "white",
            boxShadow: "0 0 8px rgba(255,255,255,0.95), 0 0 14px rgba(255,220,140,0.8)",
            ["--sparkle-x" as string]: `${s.x}px`,
            ["--sparkle-y" as string]: `${s.y}px`,
            animationDelay: `${s.delay}ms`,
          }}
        />
      ))}
    </div>
  );
}

/* ---------------- Card spread ---------------- */

function CardSpread({
  pulled, flipped, onTap, onReorder,
}: {
  pulled: PulledCard[];
  flipped: Set<string>;
  onTap: (uid: string) => void;
  onReorder: (from: number, to: number) => void;
}) {
  const isMobile = useIsMobile();
  const cardW = isMobile ? 144 : 180;
  const { bind } = useDragReorder({
    onReorder,
    onTap: (i) => {
      const p = pulled[i];
      if (p) onTap(p.uid);
    },
  });

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[11px] sm:text-xs text-[var(--color-ink-muted)] inline-flex items-center gap-2">
          <GripVertical className="w-3.5 h-3.5" />
          {isMobile
            ? "Tap face-down to flip · long-press to drag"
            : "Click face-down to flip · click face-up for details · drag to rearrange"}
        </p>
      </div>
      <div
        className="grid w-full"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${cardW}px, ${cardW}px))`,
          justifyContent: "center",
          columnGap: isMobile ? 14 : 28,
          rowGap: isMobile ? 22 : 36,
        }}
      >
        {pulled.map((p, idx) => {
          const bound = bind(idx);
          const isFaceUp = flipped.has(p.uid);
          const price = isFaceUp ? getDisplayPrice(p.card, p.foil) : null;
          const isGlowing = isFaceUp && (p.card.rarity === "rare" || p.card.rarity === "mythic");
          const glowBehind = p.card.rarity === "mythic" ? "card-glow-mythic" : "card-glow-rare";
          const glowFilter = p.card.rarity === "mythic" ? "has-glow-mythic" : "has-glow-rare";
          return (
            <div
              key={p.uid}
              ref={bound.ref as React.Ref<HTMLDivElement>}
              onPointerDown={bound.onPointerDown}
              onPointerMove={bound.onPointerMove}
              onPointerUp={bound.onPointerUp}
              onPointerCancel={bound.onPointerCancel}
              data-dragging={bound["data-dragging"]}
              data-drop-target={bound["data-drop-target"]}
              className={`anim-card-rise touch-none flex flex-col items-center ${
                bound["data-drop-target"]
                  ? "card-drop-target rounded-[12px]"
                  : ""
              }`}
              style={{
                animationDelay: `${idx * 50}ms`,
                width: cardW,
                ...bound.style,
              }}
            >
              {/* Card + rarity glow (rares/mythics only, only when face-up). */}
              <div className="relative" style={{ width: cardW }}>
                {isGlowing && <div className={glowBehind} />}
                <div className={`relative ${isGlowing ? glowFilter : ""}`} style={{ zIndex: 1 }}>
                  <MagicCard
                    card={{ kind: "scryfall", card: p.card, foil: p.foil }}
                    faceUp={isFaceUp}
                    width={cardW}
                  />
                </div>
              </div>
              {/* Caption area — reserves height so the grid doesn't shift
                  when face-up vs face-down. */}
              <div className="mt-2 min-h-[2.5rem] w-full flex flex-col items-center justify-start">
                <p
                  className={`text-center text-[10px] tracking-[0.18em] uppercase font-semibold transition-opacity duration-500 ${rarityColor(
                    p.card.rarity,
                  )} ${isFaceUp ? "opacity-100" : "opacity-0"}`}
                >
                  {p.slotLabel}
                </p>
                {price && (
                  <p className="text-xs font-semibold text-[var(--color-fg)] mt-1">
                    {price.label}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function rarityColor(r: string) {
  switch (r) {
    case "mythic": return "text-[var(--color-rarity-mythic)]";
    case "rare": return "text-[var(--color-rarity-rare)]";
    case "uncommon": return "text-[var(--color-rarity-uncommon)]";
    default: return "text-[var(--color-ink-muted)]";
  }
}

/* ---------------- View toggle (Grid / Reveal) ---------------- */

function ViewToggle({
  mode, onChange,
}: {
  mode: ViewMode;
  onChange: (m: ViewMode) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-full liquid-glass">
      <ToggleButton
        active={mode === "reveal"}
        onClick={() => onChange("reveal")}
        icon={<Layers className="w-3.5 h-3.5" />}
        label="Reveal"
      />
      <ToggleButton
        active={mode === "grid"}
        onClick={() => onChange("grid")}
        icon={<LayoutGrid className="w-3.5 h-3.5" />}
        label="Grid"
      />
    </div>
  );
}

function ToggleButton({
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
      className={`inline-flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase px-3 py-1.5 rounded-full transition-colors ${
        active
          ? "bg-white text-[var(--color-bg)]"
          : "text-[var(--color-fg)] hover:bg-white/10"
      }`}
      aria-pressed={active}
    >
      {icon}
      {label}
    </button>
  );
}

/* ---------------- Pull summary ---------------- */

function PullSummary({ pulled }: { pulled: PulledCard[] }) {
  const counts = pulled.reduce<Record<string, number>>((acc, p) => {
    acc[p.card.rarity] = (acc[p.card.rarity] ?? 0) + 1;
    return acc;
  }, {});
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2 text-[var(--color-fg)]">
        <Sparkles className="w-4 h-4" />
        <span className="text-sm font-semibold">{pulled.length} cards pulled</span>
      </div>
      {(["mythic", "rare", "uncommon", "common"] as const).map((r) =>
        counts[r] ? (
          <span
            key={r}
            className={`text-[10px] tracking-wider uppercase font-semibold px-2.5 py-1 rounded-full ${rarityBadgeClass(r)}`}
          >
            {counts[r]} {r}
          </span>
        ) : null,
      )}
    </div>
  );
}

function rarityBadgeClass(r: string) {
  switch (r) {
    case "mythic":   return "bg-[var(--color-rarity-mythic)] text-[var(--color-bg)]";
    case "rare":     return "bg-[var(--color-rarity-rare)] text-[var(--color-bg)]";
    case "uncommon": return "bg-[var(--color-rarity-uncommon)] text-[var(--color-bg)]";
    default:         return "liquid-glass text-[var(--color-ink)]";
  }
}
