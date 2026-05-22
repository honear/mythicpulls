"use client";

import { useRef, useState } from "react";
import { Sparkles, RotateCcw, Save, Eye, GripVertical, LayoutGrid, Layers } from "lucide-react";
import { getCardImage, getDisplayPrice } from "@/lib/scryfall";
import { PACKS, PACK_ORDER, getPackCost, type PackType } from "@/lib/pack-rules";
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
    setTimeout(() => setPhase("revealing"), 800);
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
    <section className="mx-auto max-w-7xl w-full px-6 py-10">
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
              opacity: 0.18,
              filter: "blur(40px) saturate(140%)",
              transform: "scale(1.15)",
            }}
          />
        )}
        <div className="relative">
        <div
          data-deck-canvas
          className="relative min-h-[680px] flex flex-col items-center justify-center px-6 py-10"
          style={{
            background: `
              radial-gradient(ellipse 90% 75% at 50% 45%, rgba(37, 99, 235, 0.32), rgba(243, 111, 39, 0.16) 35%, transparent 75%),
              radial-gradient(ellipse 60% 50% at 50% 95%, rgba(251, 191, 36, 0.12), transparent 70%)
            `,
          }}
        >
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
          <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between border-t border-[var(--color-line)] px-6 py-4">
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
  packType, setMeta, offset, isCenter, onSelect, artIndex,
}: {
  packType: PackType;
  setMeta: SetMeta;
  offset: number;
  isCenter: boolean;
  onSelect: () => void;
  artIndex: number;
}) {
  const c = packHue(packType);
  // Static fan-pose rotation (applied to the outer button so the whole pack
  // leans outward). The inner body owns the cursor-driven 3D tilt.
  const fanRot = offset * 7;
  const lift = isCenter ? -18 : 0;
  const scale = isCenter ? 1.04 : 1;
  // Cursor-driven parallax: bigger tilt on the center pack since it's the
  // hero pose, slightly subdued on the side packs so the wobble doesn't
  // amplify the existing fan rotation.
  const tilt = useCardTilt({ maxTilt: isCenter ? 14 : 10, glare: true });
  // Pick a different art crop per pack so each pack reads as distinct.
  const heroArt = setMeta.heroArtCrops?.[artIndex % (setMeta.heroArtCrops.length || 1)];

  // Real Magic booster aspect is roughly 1 : 1.46 after widening. We use
  // 260 × 380 px (~30% wider than the original 200 × 380 silhouette so the
  // art crop reads at a comfortable size).
  const PACK_W = 260;
  const PACK_H = 380;

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

function RippingPack({ setMeta, packType }: { setMeta: SetMeta; packType: PackType }) {
  const c = packHue(packType);
  return (
    <div className="relative" style={{ width: 260, height: 380, perspective: 1400 }}>
      <div
        className="anim-pack-top absolute inset-x-0 top-0 h-1/2 rounded-t-xl overflow-hidden"
        style={{
          background: `linear-gradient(160deg, ${c.from} 0%, ${c.to} 100%)`,
          border: `1px solid ${c.edge}`,
          borderBottom: "none",
        }}
      >
        <div className="absolute inset-3 rounded-lg border border-white/15" />
        <div className="absolute inset-x-0 top-10 text-center font-display text-white text-3xl tracking-[0.3em] opacity-95">
          MAGIC
        </div>
      </div>
      <div
        className="anim-pack-bottom absolute inset-x-0 bottom-0 h-1/2 rounded-b-xl overflow-hidden"
        style={{
          background: `linear-gradient(160deg, ${c.from} 0%, ${c.to} 100%)`,
          border: `1px solid ${c.edge}`,
          borderTop: "none",
        }}
      >
        <div className="absolute inset-3 rounded-lg border border-white/15" />
        <div className="absolute inset-x-0 bottom-10 text-center px-4">
          <p className="font-display text-white text-2xl tracking-wider">
            {setMeta.name}
          </p>
        </div>
      </div>
      <div
        className="anim-pack-flash absolute inset-0 rounded-xl pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.95) 0%, rgba(168,85,247,0.7) 30%, transparent 70%)",
          filter: "blur(2px)",
        }}
      />
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
        <p className="text-xs text-[var(--color-ink-muted)] inline-flex items-center gap-2">
          <GripVertical className="w-3.5 h-3.5" />
          Click face-down to flip · click face-up for details · drag to rearrange
        </p>
      </div>
      <div
        className="grid w-full"
        style={{
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 180px))",
          justifyContent: "center",
          columnGap: 28,
          rowGap: 36,
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
                width: 180,
                ...bound.style,
              }}
            >
              {/* Card + rarity glow (rares/mythics only, only when face-up). */}
              <div className="relative" style={{ width: 180 }}>
                {isGlowing && <div className={glowBehind} />}
                <div className={`relative ${isGlowing ? glowFilter : ""}`} style={{ zIndex: 1 }}>
                  <MagicCard
                    card={{ kind: "scryfall", card: p.card, foil: p.foil }}
                    faceUp={isFaceUp}
                    width={180}
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
