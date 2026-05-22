"use client";

import { useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import type { PulledCard } from "@/lib/pack-open";
import { MagicCard } from "@/app/_components/MagicCard";

interface Props {
  pulled: PulledCard[];
  /** Set of uids that have been revealed (face-up). */
  flipped: Set<string>;
  /** Mark a card as revealed (called when it's dragged off the top). */
  onReveal: (uid: string) => void;
}

const CARD_W = 280;
const THROW_THRESHOLD = 120;  // px the user must drag before a card is "thrown"
const FAN_VISIBLE = 6;        // how many cards in the stack are rendered offset

/**
 * "Reveal" mode: cards are arranged as a fanned-out deck, top card grabbable.
 * Drag the top card past THROW_THRESHOLD and it flips face-up and slides into
 * the revealed row underneath. Under threshold it springs back.
 */
export function CardDeck({ pulled, flipped, onReveal }: Props) {
  // The "deck" is the cards not yet flipped, top first.
  const deck = pulled.filter((p) => !flipped.has(p.uid));
  const revealed = pulled.filter((p) => flipped.has(p.uid));

  return (
    <div className="w-full flex flex-col items-center gap-10">
      <p className="text-xs text-[var(--color-ink-muted)] inline-flex items-center gap-2">
        <Sparkles className="w-3.5 h-3.5" />
        Drag the top card off the deck to reveal it · hover for parallax
      </p>

      <div className="relative" style={{ width: CARD_W, height: CARD_W * 88 / 63 }}>
        {/* The fanned stack — render top-of-deck last so it draws on top. */}
        {deck.length === 0 ? (
          <EmptyDeck />
        ) : (
          deck
            .slice(0, FAN_VISIBLE)
            .map((p, i, arr) => {
              const stackPos = arr.length - 1 - i; // 0 = top of stack visually
              const isTop = stackPos === 0;
              return (
                <DeckCard
                  key={p.uid}
                  pulled={p}
                  stackPos={stackPos}
                  isTop={isTop}
                  onReveal={() => onReveal(p.uid)}
                />
              );
            })
        )}
      </div>

      {/* Revealed pile */}
      {revealed.length > 0 && (
        <div className="w-full">
          <p className="label-caps text-[var(--color-ink-muted)] mb-3 text-center">
            Revealed · {revealed.length} / {pulled.length}
          </p>
          <div
            className="grid gap-4 justify-center"
            style={{ gridTemplateColumns: `repeat(auto-fill, 140px)` }}
          >
            {revealed.map((p, idx) => (
              <div
                key={p.uid}
                className="anim-card-rise"
                style={{ animationDelay: `${idx * 30}ms` }}
              >
                <MagicCard
                  card={{ kind: "scryfall", card: p.card, foil: p.foil }}
                  faceUp
                  width={140}
                />
                <p
                  className={`mt-2 text-center text-[10px] tracking-[0.18em] uppercase font-semibold ${rarityColor(
                    p.card.rarity,
                  )}`}
                >
                  {p.slotLabel}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DeckCard({
  pulled, stackPos, isTop, onReveal,
}: {
  pulled: PulledCard;
  stackPos: number;
  isTop: boolean;
  onReveal: () => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<{ x: number; y: number; lastX: number; lastT: number } | null>(null);

  // Resting transform of the card in the fan.
  const restTransform = stackTransform(stackPos);
  const restZ = 100 - stackPos;
  const restShadow = `0 ${12 + stackPos * 2}px ${24 + stackPos * 4}px rgba(0, 0, 0, 0.4)`;

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!isTop) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const el = wrapperRef.current;
    if (!el) return;
    startRef.current = {
      x: e.clientX,
      y: e.clientY,
      lastX: e.clientX,
      lastT: performance.now(),
    };
    el.style.transition = "none";
    try {
      el.setPointerCapture(e.pointerId);
    } catch {}
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const start = startRef.current;
    if (!start || !isTop) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!dragging && dx * dx + dy * dy < 36) return;
    if (!dragging) setDragging(true);

    const now = performance.now();
    const dt = Math.max(1, now - start.lastT);
    const vx = (e.clientX - start.lastX) / dt;
    const tiltZ = clamp(vx * 14, -18, 18);
    start.lastX = e.clientX;
    start.lastT = now;

    const el = wrapperRef.current;
    if (!el) return;
    el.style.transform = `translate(${dx}px, ${dy}px) rotateZ(${tiltZ.toFixed(2)}deg) scale(1.02)`;
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const start = startRef.current;
    startRef.current = null;
    const el = wrapperRef.current;
    if (!el) {
      setDragging(false);
      return;
    }
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {}

    if (!start) {
      setDragging(false);
      return;
    }
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const dist = Math.hypot(dx, dy);

    if (!dragging) {
      // Tap on the top card → reveal immediately.
      animateThrowAndReveal(el, dx, dy, onReveal);
      setDragging(false);
      return;
    }

    if (dist >= THROW_THRESHOLD) {
      animateThrowAndReveal(el, dx, dy, onReveal);
    } else {
      // Spring back to fan resting position.
      el.style.transition = "transform 320ms cubic-bezier(0.22, 0.9, 0.3, 1)";
      el.style.transform = "";
      window.setTimeout(() => {
        if (el) el.style.transition = "";
      }, 360);
    }
    setDragging(false);
  }

  function onPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    startRef.current = null;
    setDragging(false);
    const el = wrapperRef.current;
    if (el) {
      el.style.transition = "transform 320ms cubic-bezier(0.22, 0.9, 0.3, 1)";
      el.style.transform = "";
      window.setTimeout(() => {
        if (el) el.style.transition = "";
      }, 360);
    }
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  }

  return (
    <div
      ref={wrapperRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className={`absolute inset-0 touch-none ${isTop ? "cursor-grab active:cursor-grabbing" : "cursor-default pointer-events-none"}`}
      style={{
        width: CARD_W,
        height: CARD_W * 88 / 63,
        transform: dragging ? undefined : restTransform,
        transition: dragging
          ? "none"
          : "transform 380ms cubic-bezier(0.22, 0.9, 0.3, 1), box-shadow 380ms ease",
        zIndex: dragging ? 999 : restZ,
        filter: stackPos > 0 ? `brightness(${1 - stackPos * 0.06})` : undefined,
        boxShadow: restShadow,
        willChange: "transform",
      }}
    >
      <MagicCard
        card={{ kind: "scryfall", card: pulled.card, foil: pulled.foil }}
        faceUp={false}
        width={CARD_W}
      />
    </div>
  );
}

function animateThrowAndReveal(
  el: HTMLDivElement,
  dx: number,
  dy: number,
  onReveal: () => void,
) {
  // Project the card off in the same direction, accelerating.
  const mag = Math.max(THROW_THRESHOLD, Math.hypot(dx, dy));
  const nx = (dx / Math.max(1, Math.hypot(dx, dy))) * 600;
  const ny = (dy / Math.max(1, Math.hypot(dx, dy))) * 600;
  const spinDir = dx >= 0 ? 1 : -1;
  el.style.transition =
    "transform 440ms cubic-bezier(0.4, 0.0, 0.2, 1), opacity 440ms ease";
  el.style.transform = `translate(${nx}px, ${ny}px) rotateZ(${spinDir * 30}deg) scale(0.9)`;
  el.style.opacity = "0";
  window.setTimeout(() => {
    onReveal();
    // Defensive: clear inline styles in case the element is reused.
    if (el) {
      el.style.transition = "";
      el.style.transform = "";
      el.style.opacity = "";
    }
  }, 380);
  // mag silences unused-var lints if the linter strict-checks it
  void mag;
}

/** Resting transform of a card at `stackPos` (0 = top of deck). */
function stackTransform(stackPos: number): string {
  if (stackPos === 0) return "translate(0, 0) rotate(0deg) scale(1)";
  const ty = -5 * stackPos;
  const rot = 6 * stackPos;
  const scale = 1 - stackPos * 0.02;
  return `translate(0, ${ty}px) rotate(${rot}deg) scale(${scale})`;
}

function EmptyDeck() {
  return (
    <div className="absolute inset-0 liquid-panel rounded-2xl grid place-items-center text-center">
      <div className="px-8">
        <p className="font-display text-2xl text-[var(--color-fg)]">Deck empty.</p>
        <p className="text-sm text-[var(--color-ink-muted)] mt-2">
          Every card is revealed below.
        </p>
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

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
