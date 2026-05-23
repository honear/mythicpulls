"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { PulledCard } from "@/lib/pack-open";
import { MagicCard } from "@/app/_components/MagicCard";

/* ===========================================================================
   SealedPackGrid
   ---------------------------------------------------------------------------
   Sealed packs reveal in a single grid view rather than the manual reveal
   deck. Every card mounts face-down with a staggered rise-in, then flips
   face-up on its own. After the last flip, a "Continue" button lights up so
   the player can advance to the next pack (or to the deck builder).
   No clicks needed *within* a pack.
   =========================================================================== */

const CARD_W_DESKTOP = 158;
// Sized so three columns fit inside the SealedRun canvas at a 375px
// viewport: (canvas inner width ~325px) − 2 × 10px gap = 305px, ÷ 3 ≈ 96px.
const CARD_W_MOBILE = 96;
const FLIP_STAGGER_MS = 110;     // delay between successive card flips
const FLIP_INITIAL_DELAY = 220;  // brief beat before card 0 flips
const CONTINUE_HOLD_MS = 700;    // pause after the last flip before the CTA appears

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

interface Props {
  pulled: PulledCard[];
  /** Triggered when the user clicks the Continue CTA. Parent decides
   *  whether to rip the next pack or go to the deck builder. */
  onContinue: () => void;
  /** Label on the CTA — e.g. "Open pack 2 of 6" or "Continue to deck builder". */
  continueLabel: string;
}

export function SealedPackGrid({ pulled, onContinue, continueLabel }: Props) {
  const isMobile = useIsMobile();
  const cardW = isMobile ? CARD_W_MOBILE : CARD_W_DESKTOP;
  const [flipped, setFlipped] = useState<Set<string>>(() => new Set());
  const [ctaReady, setCtaReady] = useState(false);

  // Re-run on every new pack (parent reuses the component by passing fresh
  // `pulled`). Reset state and schedule the stagger of flips.
  useEffect(() => {
    setFlipped(new Set());
    setCtaReady(false);
    const timers: number[] = [];
    pulled.forEach((p, i) => {
      const t = window.setTimeout(() => {
        setFlipped((prev) => {
          if (prev.has(p.uid)) return prev;
          const next = new Set(prev);
          next.add(p.uid);
          return next;
        });
      }, FLIP_INITIAL_DELAY + i * FLIP_STAGGER_MS);
      timers.push(t);
    });
    const last = window.setTimeout(
      () => setCtaReady(true),
      FLIP_INITIAL_DELAY + pulled.length * FLIP_STAGGER_MS + CONTINUE_HOLD_MS,
    );
    timers.push(last);
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [pulled]);

  return (
    <div className="w-full flex flex-col items-center gap-5 sm:gap-7">
      <div
        className="grid gap-2.5 sm:gap-4 justify-center w-full"
        style={{
          gridTemplateColumns: `repeat(auto-fit, minmax(${cardW}px, ${cardW}px))`,
          maxWidth: 1180,
        }}
      >
        {pulled.map((p, i) => (
          <CardSlot
            key={p.uid}
            pulled={p}
            cardW={cardW}
            faceUp={flipped.has(p.uid)}
            mountDelayMs={i * FLIP_STAGGER_MS}
          />
        ))}
      </div>

      <button
        onClick={onContinue}
        disabled={!ctaReady}
        className="inline-flex items-center gap-2 px-6 py-3 rounded-[10px] text-[15px] font-medium transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          background: "var(--accent-purple)",
          color: "white",
          fontFamily: "var(--font-btn)",
          boxShadow:
            "0 12px 30px -10px var(--accent-purple-glow), inset 0 1px 0 rgba(255,255,255,0.18)",
        }}
      >
        {continueLabel}
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}

function CardSlot({
  pulled, cardW, faceUp, mountDelayMs,
}: {
  pulled: PulledCard;
  cardW: number;
  faceUp: boolean;
  mountDelayMs: number;
}) {
  const rarity = pulled.card.rarity;
  // Only rare and mythic get the glow. Token / common / uncommon stay
  // visually quiet so the chase pulls actually feel chase-y.
  const isGlowing = faceUp && (rarity === "rare" || rarity === "mythic");
  const glowBehind = rarity === "mythic" ? "card-glow-mythic" : "card-glow-rare";
  const glowFilter = rarity === "mythic" ? "has-glow-mythic" : "has-glow-rare";

  return (
    <div
      className="relative anim-card-rise"
      style={{
        width: cardW,
        animationDelay: `${mountDelayMs}ms`,
      }}
    >
      {/* Two-layer glow: a soft animated radial behind, plus a drop-shadow
          on the card wrapper that hugs the rounded card silhouette. The
          drop-shadow guarantees a visible colored aura even if the radial
          gradient gets washed out by the dark backdrop. */}
      {isGlowing && <div className={glowBehind} />}
      <div className={`relative ${isGlowing ? glowFilter : ""}`} style={{ zIndex: 1 }}>
        <MagicCard
          card={{ kind: "scryfall", card: pulled.card, foil: pulled.foil }}
          faceUp={faceUp}
          width={cardW}
          holoEnabled
        />
      </div>
    </div>
  );
}
