"use client";

import { useMemo } from "react";
import { Hand } from "lucide-react";
import type { PulledCard } from "@/lib/pack-open";
import { MagicCard } from "@/app/_components/MagicCard";
import { HoverPreview } from "@/app/_components/HoverPreview";
import { useHoverPreview } from "@/lib/useHoverPreview";

const CARD_W = 174;
const CARD_H = Math.round((CARD_W * 88) / 63);

// 5 × 3 grid = 15 cells, the max-size Draft Booster pack (minus token).
// Keeps the canvas dimensions constant regardless of how many cards
// remain — empty rows at the bottom just sit blank while picks deplete
// the pack.
const GRID_COLS = 5;
const GRID_ROWS = 3;
const GRID_GAP = 16;

const RARITY_ORDER: Record<string, number> = {
  mythic: 0,
  rare: 1,
  uncommon: 2,
  common: 3,
  special: 4,
  bonus: 5,
};

function isLand(card: { type_line?: string }): boolean {
  return (card.type_line ?? "").toLowerCase().includes("land");
}

/** Stable per-uid jitter used for staggering exit/enter delays. Mixing
 *  in a `salt` lets exit and enter use different timing profiles for the
 *  same card. */
function hashJitter(uid: string, salt: string, maxMs: number): number {
  let h = 0;
  const s = uid + salt;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % maxMs;
}

/** Display order — non-lands first, sorted by rarity (mythics first → rares
 *  → uncommons → commons), then lands at the very end. Within each rarity
 *  band sort by mana value then name so the layout is deterministic across
 *  re-renders (no card hopping cells). */
function sortPackByRarity(pack: PulledCard[]): PulledCard[] {
  return [...pack].sort((a, b) => {
    const al = isLand(a.card) ? 1 : 0;
    const bl = isLand(b.card) ? 1 : 0;
    if (al !== bl) return al - bl;
    const ar = RARITY_ORDER[a.card.rarity] ?? 9;
    const br = RARITY_ORDER[b.card.rarity] ?? 9;
    if (ar !== br) return ar - br;
    const ac = a.card.cmc ?? 0;
    const bc = b.card.cmc ?? 0;
    if (ac !== bc) return ac - bc;
    return a.card.name.localeCompare(b.card.name);
  });
}

/**
 * Current pack rendered as a 5×3 grid (fixed cells). Two modes:
 *   • "enter" — cards stagger in from the side they were passed from
 *               (opposite of the round's pass direction). Default.
 *   • "exit"  — cards stagger out in the pass direction; the picked
 *               card lifts up + fades instead.
 * The parent DraftRun owns the transition timing — it flips mode to
 * "exit" on click, waits ~280ms, then commits the new pack as a fresh
 * mount which triggers "enter".
 */
export function DraftPickPanel({
  pack, onPick, mode, exitDirection, pickedUid, hint,
}: {
  pack: PulledCard[];
  onPick: (uid: string) => void;
  mode: "enter" | "exit";
  /** Direction packs are passing this round. "left" → cards depart toward
   *  the left and the next pack arrives from the right. */
  exitDirection: "left" | "right";
  /** Uid of the card the user just picked. Only honored in mode="exit"
   *  to apply the lift animation to that one card. */
  pickedUid?: string;
  hint: string;
}) {
  const sorted = useMemo(() => sortPackByRarity(pack), [pack]);
  const { preview, armHover, clearHover } = useHoverPreview();

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-xs text-[var(--color-ink-muted)] inline-flex items-center gap-2">
        <Hand className="w-3.5 h-3.5" />
        {hint}
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${GRID_COLS}, ${CARD_W}px)`,
          gridAutoRows: `${CARD_H}px`,
          gap: GRID_GAP,
          justifyContent: "center",
          alignContent: "start",
          // Reserve the full 3-row height so the canvas size stays constant
          // even when only a couple of cards remain in the pack.
          minHeight: GRID_ROWS * CARD_H + (GRID_ROWS - 1) * GRID_GAP,
        }}
      >
        {sorted.map((p) => (
          <PickableCard
            key={p.uid}
            pulled={p}
            onPick={() => { clearHover(); onPick(p.uid); }}
            mode={mode}
            exitDirection={exitDirection}
            isPicked={mode === "exit" && pickedUid === p.uid}
            onHover={armHover}
            onHoverEnd={clearHover}
          />
        ))}
      </div>
      {preview && mode === "enter" && (
        <HoverPreview
          card={preview.card}
          foil={preview.foil}
          x={preview.x}
          y={preview.y}
        />
      )}
    </div>
  );
}

function PickableCard({
  pulled, onPick, mode, exitDirection, isPicked, onHover, onHoverEnd,
}: {
  pulled: PulledCard;
  onPick: () => void;
  mode: "enter" | "exit";
  exitDirection: "left" | "right";
  isPicked: boolean;
  /** Called from pointerenter/pointermove to (re-)arm the 200ms preview
   *  timer. The hook ignores touch pointers automatically. */
  onHover: (card: import("@/lib/scryfall").ScryfallCard, foil: boolean, e: React.PointerEvent) => void;
  /** Called from pointerleave (and at the start of a click) to cancel
   *  any pending preview and hide an active one. */
  onHoverEnd: () => void;
}) {
  const rarity = pulled.card.rarity;
  const isGlowing = rarity === "rare" || rarity === "mythic";
  const glowBehind = rarity === "mythic" ? "card-glow-mythic" : "card-glow-rare";
  const glowFilter = rarity === "mythic" ? "has-glow-mythic" : "has-glow-rare";

  // Pick the right animation class + inline CSS vars + delay for this card.
  // Exit goes in the pass direction; enter starts from the opposite side
  // (the new pack came from the opposite neighbor).
  let className = "block transition-transform hover:-translate-y-1 focus:outline-none";
  const cssVars: React.CSSProperties = { width: CARD_W };

  if (mode === "exit") {
    if (isPicked) {
      className += " draft-pick-card--picked";
    } else {
      className += " draft-pick-card--exit";
      const exitX = exitDirection === "left" ? -440 : 440;
      const tilt = exitDirection === "left" ? -6 : 6;
      // Tighter jitter range (0–120ms) — the parent's swap timeout has to
      // wait for the slowest card to finish, and an animation that starts
      // 160ms in barely has time to play before we cut to the new pack.
      const jitter = hashJitter(pulled.uid, "exit", 120);
      (cssVars as Record<string, string>)["--exit-x"] = `${exitX}px`;
      (cssVars as Record<string, string>)["--exit-tilt"] = `${tilt}deg`;
      cssVars.animationDelay = `${jitter}ms`;
    }
  } else {
    className += " draft-pick-card--enter";
    // Enter comes from the OPPOSITE side of the pass direction.
    const enterX = exitDirection === "left" ? 440 : -440;
    const tilt = exitDirection === "left" ? 6 : -6;
    const jitter = hashJitter(pulled.uid, "enter", 110);
    (cssVars as Record<string, string>)["--enter-x"] = `${enterX}px`;
    (cssVars as Record<string, string>)["--enter-tilt"] = `${tilt}deg`;
    cssVars.animationDelay = `${jitter}ms`;
  }

  return (
    <button
      onClick={onPick}
      disabled={mode === "exit"}
      onPointerEnter={(e) => onHover(pulled.card, pulled.foil, e)}
      onPointerMove={(e) => onHover(pulled.card, pulled.foil, e)}
      onPointerLeave={onHoverEnd}
      onPointerDown={onHoverEnd}
      className={className}
      style={cssVars}
      aria-label={`Pick ${pulled.card.name}`}
    >
      <div className="relative" style={{ width: CARD_W }}>
        {isGlowing && <div className={glowBehind} />}
        <div className={`relative ${isGlowing ? glowFilter : ""}`} style={{ zIndex: 1 }}>
          <MagicCard
            card={{ kind: "scryfall", card: pulled.card, foil: pulled.foil }}
            faceUp
            width={CARD_W}
            holoEnabled
          />
        </div>
      </div>
    </button>
  );
}
