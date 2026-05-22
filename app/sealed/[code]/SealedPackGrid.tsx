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

const CARD_W = 158;
const FLIP_STAGGER_MS = 110;     // delay between successive card flips
const FLIP_INITIAL_DELAY = 220;  // brief beat before card 0 flips
const CONTINUE_HOLD_MS = 700;    // pause after the last flip before the CTA appears

interface Props {
  pulled: PulledCard[];
  /** Triggered when the user clicks the Continue CTA. Parent decides
   *  whether to rip the next pack or go to the deck builder. */
  onContinue: () => void;
  /** Label on the CTA — e.g. "Open pack 2 of 6" or "Continue to deck builder". */
  continueLabel: string;
}

export function SealedPackGrid({ pulled, onContinue, continueLabel }: Props) {
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
    <div className="w-full flex flex-col items-center gap-7">
      <div
        className="grid gap-4 justify-center"
        style={{
          gridTemplateColumns: `repeat(auto-fit, minmax(${CARD_W}px, ${CARD_W}px))`,
          maxWidth: 1180,
        }}
      >
        {pulled.map((p, i) => (
          <CardSlot
            key={p.uid}
            pulled={p}
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
  pulled, faceUp, mountDelayMs,
}: {
  pulled: PulledCard;
  faceUp: boolean;
  mountDelayMs: number;
}) {
  const rarity = pulled.card.rarity;
  // Only rare and mythic get the glow. Token / common / uncommon stay
  // visually quiet so the chase pulls actually feel chase-y.
  const glowClass =
    rarity === "mythic"
      ? "card-glow-mythic"
      : rarity === "rare"
        ? "card-glow-rare"
        : null;

  return (
    <div
      className="relative anim-card-rise"
      style={{
        width: CARD_W,
        animationDelay: `${mountDelayMs}ms`,
      }}
    >
      {/* Glow only blooms after the card flips face-up — keeps the reveal
          itself as the moment of recognition, not a pre-flip spoiler. */}
      {glowClass && faceUp && <div className={glowClass} />}
      <div className="relative" style={{ zIndex: 1 }}>
        <MagicCard
          card={{ kind: "scryfall", card: pulled.card, foil: pulled.foil }}
          faceUp={faceUp}
          width={CARD_W}
          holoEnabled
        />
      </div>
    </div>
  );
}
