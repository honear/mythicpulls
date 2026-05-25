"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Hand } from "lucide-react";
import type { PulledCard } from "@/lib/pack-open";
import { MagicCard } from "@/app/_components/MagicCard";
import { HoverPreview } from "@/app/_components/HoverPreview";
import { TouchPreview } from "@/app/_components/TouchPreview";
import { useHoverPreview } from "@/lib/useHoverPreview";
import { hapticTap } from "@/lib/haptics";

// Card width + column count adapt to viewport. Desktop keeps the planned
// 5 × 3 layout; tablets drop to 4 columns; phones use 3 narrower columns
// (3 × 5 = same 15 cells but stacked taller, fits inside a 375px viewport
// with the side padding the canvas applies).
const LAYOUT_DESKTOP = { cols: 5, w: 174, gap: 16 };
const LAYOUT_TABLET  = { cols: 4, w: 158, gap: 14 };
const LAYOUT_MOBILE  = { cols: 3, w: 100, gap: 10 };

function useDraftLayout() {
  const [layout, setLayout] = useState(LAYOUT_DESKTOP);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mobile = window.matchMedia("(max-width: 639px)");
    const tablet = window.matchMedia("(min-width: 640px) and (max-width: 1023px)");
    const resolve = () => {
      if (mobile.matches) setLayout(LAYOUT_MOBILE);
      else if (tablet.matches) setLayout(LAYOUT_TABLET);
      else setLayout(LAYOUT_DESKTOP);
    };
    resolve();
    mobile.addEventListener("change", resolve);
    tablet.addEventListener("change", resolve);
    return () => {
      mobile.removeEventListener("change", resolve);
      tablet.removeEventListener("change", resolve);
    };
  }, []);
  return layout;
}

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
  /** target tells the parent where the pick should land:
   *   • "deck" — desktop left-click → auto-place in the deck builder's
   *              default mana-value column.
   *   • "pool" — desktop right-click + every touch/keyboard activation →
   *              leave the card in the pool for the user to triage later
   *              (the historical behavior). */
  onPick: (uid: string, target: "deck" | "pool") => void;
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
  const layout = useDraftLayout();
  const isDesktop = layout === LAYOUT_DESKTOP;
  // Mobile peek — triggered by tapping the loupe ("+" magnifier) on
  // each card. Replaces the earlier long-press gesture, which fought
  // iOS Safari's image-save callout on the underlying <img>. Single
  // overlay state at the panel level so taps across cards share the
  // mount lifecycle and avoid a per-card render storm.
  const [touchPreview, setTouchPreview] = useState<PulledCard | null>(null);
  // Rows = total grid slots / cols. Draft Boosters max 15 (5×3); mobile
  // collapses to 3×5; tablet to 4×4. The minHeight reserves the full grid
  // so the canvas doesn't visibly shrink as picks drain the pack.
  const totalSlots = 15;
  const rows = Math.ceil(totalSlots / layout.cols);
  const cardH = Math.round((layout.w * 88) / 63);

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <p className="text-[11px] sm:text-xs text-[var(--color-ink-muted)] inline-flex items-center gap-2 text-center px-2">
        <Hand className="w-3.5 h-3.5 shrink-0" />
        <span>
          {hint}
          {isDesktop ? (
            <>
              {" · "}
              <span className="text-[var(--accent-purple-light)]">left-click</span>
              {" → deck · "}
              <span className="text-[var(--accent-purple-light)]">right-click</span>
              {" → pool"}
            </>
          ) : (
            " · tap a card to take it"
          )}
        </span>
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${layout.cols}, ${layout.w}px)`,
          gridAutoRows: `${cardH}px`,
          gap: layout.gap,
          justifyContent: "center",
          alignContent: "start",
          minHeight: rows * cardH + (rows - 1) * layout.gap,
        }}
      >
        {sorted.map((p) => (
          <PickableCard
            key={p.uid}
            pulled={p}
            cardW={layout.w}
            onPick={(target) => { clearHover(); onPick(p.uid, target); }}
            onPreview={() => setTouchPreview(p)}
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
      {touchPreview && (
        <TouchPreview
          card={{ kind: "scryfall", card: touchPreview.card, foil: touchPreview.foil }}
          onDismiss={() => setTouchPreview(null)}
        />
      )}
    </div>
  );
}

function PickableCard({
  pulled, cardW, onPick, onPreview, mode, exitDirection, isPicked, onHover, onHoverEnd,
}: {
  pulled: PulledCard;
  cardW: number;
  /** target chosen by the input: mouse-left → "deck", everything else
   *  (mouse-right via contextmenu, touch, keyboard activation) → "pool".
   *  We detect mouse vs. touch from the last pointerdown's pointerType so
   *  that synthetic keyboard `click` events (no preceding pointerdown)
   *  fall through to the desktop default. */
  onPick: (target: "deck" | "pool") => void;
  /** Mobile-only — fires when the user taps the loupe ("+" magnifier)
   *  button rendered on top of the card art. The button stops
   *  propagation so this never collides with the pick (`onPick`). */
  onPreview: () => void;
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
  const cssVars: React.CSSProperties = { width: cardW };

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

  // Pointer source for the most recent press. "mouse" defaults so a
  // keyboard activation (Enter/Space — no preceding pointerdown) is
  // treated as a desktop click and routes the card into the deck. Touch
  // taps overwrite this to "touch" via pointerdown, so the tap fallback
  // routes to the pool (existing mobile behavior).
  const lastPointerType = useRef<string>("mouse");

  return (
    <button
      onClick={() => {
        hapticTap();
        onPick(lastPointerType.current === "mouse" ? "deck" : "pool");
      }}
      onContextMenu={(e) => {
        // Suppress the OS menu and route the pick to the pool. We don't
        // call onPick here for non-mouse pointers — touch devices don't
        // fire contextmenu in the same way and we want the tap path to
        // remain the only entry point on mobile.
        if (mode === "exit") { e.preventDefault(); return; }
        e.preventDefault();
        hapticTap();
        onHoverEnd();
        onPick("pool");
      }}
      disabled={mode === "exit"}
      onPointerEnter={(e) => onHover(pulled.card, pulled.foil, e)}
      onPointerMove={(e) => onHover(pulled.card, pulled.foil, e)}
      onPointerLeave={onHoverEnd}
      onPointerDown={(e) => { lastPointerType.current = e.pointerType || "mouse"; onHoverEnd(); }}
      className={className}
      style={cssVars}
      aria-label={`Pick ${pulled.card.name}`}
    >
      <div className="relative" style={{ width: cardW }}>
        {isGlowing && <div className={glowBehind} />}
        <div className={`relative ${isGlowing ? glowFilter : ""}`} style={{ zIndex: 1 }}>
          <MagicCard
            card={{ kind: "scryfall", card: pulled.card, foil: pulled.foil }}
            faceUp
            width={cardW}
            holoEnabled
            onPreview={onPreview}
          />
        </div>
      </div>
    </button>
  );
}
