"use client";

import { useMemo, useState } from "react";
import { Sparkles, RotateCcw, Save, Eye, GripVertical } from "lucide-react";
import type { ScryfallCard } from "@/lib/scryfall";
import { getCardImage } from "@/lib/scryfall";
import { PACKS, PACK_ORDER, type PackType } from "@/lib/pack-rules";
import { buildPool, openPack, type PulledCard } from "@/lib/pack-open";
import { addToCollection } from "@/lib/collection";
import { useDragReorder } from "@/lib/useDragReorder";
import { MagicCard } from "@/app/_components/MagicCard";

interface SetMeta { code: string; name: string; iconUri?: string }

interface Props {
  setMeta: SetMeta;
  cards: ScryfallCard[];
  availableTypes: PackType[];
  initialType: PackType;
}

type Phase = "idle" | "ripping" | "revealing";

export function PackOpener({ setMeta, cards, availableTypes, initialType }: Props) {
  const [packType, setPackType] = useState<PackType>(initialType);
  const [phase, setPhase] = useState<Phase>("idle");
  const [pulled, setPulled] = useState<PulledCard[]>([]);
  const [flipped, setFlipped] = useState<Set<string>>(new Set());

  const pool = useMemo(() => buildPool(cards), [cards]);
  const def = PACKS[packType];

  function rip() {
    if (phase !== "idle") return;
    setPhase("ripping");
    const result = openPack(pool, packType);
    setPulled(result);
    setFlipped(new Set());
    setTimeout(() => setPhase("revealing"), 800);
  }

  function reset() {
    setPhase("idle");
    setPulled([]);
    setFlipped(new Set());
  }

  function flipAll() {
    setFlipped(new Set(pulled.map((p) => p.uid)));
  }

  function flipOne(uid: string) {
    setFlipped((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
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

  return (
    <section className="mx-auto max-w-7xl w-full px-6 py-10">
      <div className="rounded-2xl liquid-panel overflow-hidden">
        <PackTypeBar
          available={availableTypes}
          current={packType}
          onChange={(t) => phase === "idle" && setPackType(t)}
          disabled={phase !== "idle"}
        />

        <div
          className="relative min-h-[560px] flex items-center justify-center px-6 py-12"
          style={{
            background:
              "radial-gradient(ellipse 70% 55% at 50% 35%, rgba(168, 85, 247, 0.18), transparent 65%)",
          }}
        >
          {phase === "idle" && (
            <div className="flex flex-col items-center gap-8">
              <BoosterPack setMeta={setMeta} onClick={rip} packType={packType} />
              <button
                onClick={rip}
                className="btn-hero-secondary liquid-glass rounded-full text-sm font-semibold px-7 py-3.5"
              >
                Rip {def.name.toLowerCase()}
              </button>
              <p className="text-sm text-[var(--color-ink)] max-w-md text-center">
                {def.tagline}
              </p>
            </div>
          )}

          {phase === "ripping" && (
            <RippingPack setMeta={setMeta} packType={packType} />
          )}

          {phase === "revealing" && (
            <CardSpread
              pulled={pulled}
              flipped={flipped}
              onFlip={flipOne}
              onReorder={reorder}
            />
          )}
        </div>

        {phase === "revealing" && (
          <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between border-t border-[var(--color-line)] px-6 py-4">
            <PullSummary pulled={pulled} />
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
    </section>
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
  pulled, flipped, onFlip, onReorder,
}: {
  pulled: PulledCard[];
  flipped: Set<string>;
  onFlip: (uid: string) => void;
  onReorder: (from: number, to: number) => void;
}) {
  const { bind } = useDragReorder({ onReorder });

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-[var(--color-ink-muted)] inline-flex items-center gap-2">
          <GripVertical className="w-3.5 h-3.5" />
          Click to flip · drag to rearrange · hover for parallax
        </p>
      </div>
      <div
        className="grid gap-5 w-full justify-center"
        style={{
          gridTemplateColumns: "repeat(auto-fill, 180px)",
          justifyContent: "center",
        }}
      >
        {pulled.map((p, idx) => {
          const bound = bind(idx);
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
              className={`anim-card-rise touch-none ${
                bound["data-dragging"] ? "card-dragging" : ""
              } ${bound["data-drop-target"] ? "card-drop-target rounded-[12px]" : ""}`}
              style={{ animationDelay: `${idx * 50}ms` }}
            >
              <MagicCard
                card={{ kind: "scryfall", card: p.card, foil: p.foil }}
                faceUp={flipped.has(p.uid)}
                onClick={() => onFlip(p.uid)}
                width={undefined}
              />
              <p
                className={`mt-2 text-center text-[10px] tracking-[0.18em] uppercase font-semibold transition-opacity duration-500 ${rarityColor(
                  p.card.rarity,
                )} ${flipped.has(p.uid) ? "opacity-100" : "opacity-0"}`}
              >
                {p.slotLabel}
              </p>
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
