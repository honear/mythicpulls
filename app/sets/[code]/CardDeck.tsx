"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Hand } from "lucide-react";
import type { PulledCard } from "@/lib/pack-open";
import { getDisplayPrice } from "@/lib/scryfall";
import { MagicCard } from "@/app/_components/MagicCard";

interface Props {
  pulled: PulledCard[];
  /** Fired the first time every card in the deck has been the top. */
  onAllRevealed?: () => void;
  /** Fired the first time a uid becomes the top of the deck. Idempotent on
   *  the parent's side — used to roll the pulled-price tally forward. */
  onCardSeen?: (uid: string) => void;
}

const CARD_W = 320;
const STACK_DEPTH = 5;           // visible cards at any time
const THRESHOLD = 6;             // px before press becomes a drag
const COMMIT_DIST = 40;          // px before the deck cycles
const STAGE_PAD = 80;

/**
 * Reveal mode — a cycling deck rendered face-up.
 *
 *  • Cards underneath the top sit at small randomized angles (±2°, seeded
 *    by uid so each card's tilt is stable across renders).
 *  • The first time the drag passes `COMMIT_DIST`, the cycleOrder shifts:
 *    the dragged uid moves to the back of the deck and the next card
 *    smoothly animates up to take its place. The dragged card continues
 *    to follow the cursor.
 *  • On release, the dragged card's inline transform is cleared. Its
 *    resting position is now the back of the stack, so the CSS transition
 *    animates it sliding behind the deck.
 */
export function CardDeck({ pulled, onAllRevealed, onCardSeen }: Props) {
  const [cycleOrder, setCycleOrder] = useState<string[]>(() =>
    pulled.map((p) => p.uid),
  );
  const [draggingUid, setDraggingUid] = useState<string | null>(null);
  /** Uids that have been the top of the deck at least once. Starts with the
   *  initial top, since it's immediately visible. */
  const [seen, setSeen] = useState<Set<string>>(
    () => new Set(pulled.length ? [pulled[0].uid] : []),
  );

  // Keep the latest callback in a ref so the init effect only depends on
  // `pulled`. Without this, every parent rerender (e.g. a price update)
  // would change the function reference and wipe the deck state.
  const onCardSeenRef = useRef(onCardSeen);
  useEffect(() => {
    onCardSeenRef.current = onCardSeen;
  }, [onCardSeen]);

  const onAllRevealedRef = useRef(onAllRevealed);
  useEffect(() => {
    onAllRevealedRef.current = onAllRevealed;
  }, [onAllRevealed]);

  useEffect(() => {
    setCycleOrder(pulled.map((p) => p.uid));
    setSeen(new Set(pulled.length ? [pulled[0].uid] : []));
    if (pulled.length) onCardSeenRef.current?.(pulled[0].uid);
  }, [pulled]);

  const byUid = useMemo(() => {
    const m = new Map<string, PulledCard>();
    for (const p of pulled) m.set(p.uid, p);
    return m;
  }, [pulled]);

  function sendToBack(uid: string) {
    setCycleOrder((prev) => {
      const filtered = prev.filter((u) => u !== uid);
      const next = [...filtered, uid];
      const newTop = next[0];
      setSeen((prevSeen) => {
        if (!newTop || prevSeen.has(newTop)) return prevSeen;
        // Roll the pulled-price tally forward (idempotent on the parent).
        onCardSeenRef.current?.(newTop);
        const out = new Set(prevSeen);
        out.add(newTop);
        if (out.size >= pulled.length) {
          window.setTimeout(() => onAllRevealedRef.current?.(), 420);
        }
        return out;
      });
      return next;
    });
  }

  const topUid = cycleOrder[0];
  const topPulled = topUid ? byUid.get(topUid) : undefined;
  const topPrice = topPulled
    ? getDisplayPrice(topPulled.card, topPulled.foil)
    : null;

  const stackH = CARD_W * 88 / 63;

  return (
    <div className="w-full flex flex-col items-center gap-5">
      <p className="text-xs text-[var(--color-ink-muted)] inline-flex items-center gap-2">
        <Hand className="w-3.5 h-3.5" />
        Drag the top card to send it to the back · click for details
      </p>

      {/* Fixed-size stage so the page height never shifts as cards cycle. */}
      <div
        className="relative"
        style={{ width: CARD_W + STAGE_PAD, height: stackH + 60 }}
      >
        {cycleOrder.map((uid, i) => {
          const p = byUid.get(uid);
          if (!p) return null;
          // Render every card always. Cards past the visible window clamp
          // to the back-of-stack rest slot — they overlap there but only
          // the latest in DOM order is visible. Keeping them mounted lets
          // the snap-back transition play after a release.
          return (
            <DeckSlot
              key={uid}
              pulled={p}
              stackPos={Math.min(i, STACK_DEPTH - 1)}
              behindStack={i >= STACK_DEPTH}
              isTop={i === 0}
              onCommitCycle={() => sendToBack(uid)}
              onDragStateChange={(d) => setDraggingUid(d ? uid : null)}
            />
          );
        })}
      </div>

      {/* Footer: reserves vertical space so name/price changes don't move
          surrounding content. */}
      <div className="flex flex-col items-center gap-1 min-h-[3.5rem]">
        {topPulled && (
          <>
            <p className="font-display text-xl text-[var(--color-fg)] leading-tight">
              {topPulled.card.name}
            </p>
            <p className="text-xs text-[var(--color-ink-muted)]">
              {seen.size} / {pulled.length} seen
              {topPrice ? ` · ${topPrice.label}` : ""}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------- Single card slot ---------------- */

function DeckSlot({
  pulled, stackPos, behindStack, isTop, onCommitCycle, onDragStateChange,
}: {
  pulled: PulledCard;
  stackPos: number;
  /** When true, the card has cycled past the visible window; it should
   *  finish its animation toward the back, then fade out. */
  behindStack: boolean;
  isTop: boolean;
  onCommitCycle: () => void;
  onDragStateChange: (dragging: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const committedRef = useRef(false);
  const startRef = useRef<{ x: number; y: number; lastX: number; lastT: number } | null>(null);

  const rest = useMemo(() => stackTransform(stackPos, pulled.uid), [stackPos, pulled.uid]);

  function setIsDragging(v: boolean) {
    setDragging(v);
    onDragStateChange(v);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!isTop) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const el = ref.current;
    if (!el) return;
    startRef.current = {
      x: e.clientX,
      y: e.clientY,
      lastX: e.clientX,
      lastT: performance.now(),
    };
    committedRef.current = false;
    // Note: transition is suppressed via the .deck-slot-dragging class
    // toggled by `dragging` state — not via inline style here. Setting it
    // inline would leak past pointerUp and break the snap-back transition.
    try { el.setPointerCapture(e.pointerId); } catch {}
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const start = startRef.current;
    // No isTop check here: by the time `start` is set, this card already
    // owned the drag at press time. After the cycle commits, isTop flips
    // to false — but the user is still holding the same pointer down, and
    // we must keep responding to their movement.
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const dist2 = dx * dx + dy * dy;
    if (!dragging && dist2 < THRESHOLD * THRESHOLD) return;
    if (!dragging) setIsDragging(true);

    // Commit the cycle the first time we cross COMMIT_DIST so the rest of
    // the deck starts animating forward while the user is still holding.
    if (!committedRef.current && dist2 >= COMMIT_DIST * COMMIT_DIST) {
      committedRef.current = true;
      onCommitCycle();
    }

    const now = performance.now();
    const dt = Math.max(1, now - start.lastT);
    const vx = (e.clientX - start.lastX) / dt;
    const tiltZ = Math.max(-10, Math.min(10, vx * 11));
    start.lastX = e.clientX;
    start.lastT = now;

    const el = ref.current;
    if (!el) return;
    el.style.transform =
      `translate(${dx}px, ${dy}px) rotateZ(${tiltZ.toFixed(2)}deg)`;
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const start = startRef.current;
    startRef.current = null;
    const el = ref.current;
    if (!el) { setIsDragging(false); return; }
    try { el.releasePointerCapture(e.pointerId); } catch {}

    if (!start) { setIsDragging(false); return; }

    if (!dragging) {
      // Pure tap in Reveal mode — animate the card out as if the user
      // had thrown it, then commit the cycle. No modal.
      animateCycleOut(el, onCommitCycle);
      return;
    }

    // Real drag release: DON'T clear the inline transform here. Doing so
    // would reset transform to identity in the previous frame (when
    // transition is still locked to "none" via .deck-slot-dragging), so
    // when React rerenders the next frame with transform=rest the browser
    // would have nothing to animate from. Leaving the cursor-tracked
    // transform in place lets React's commit do both at once:
    //   • remove the .deck-slot-dragging class → transition becomes 380ms
    //   • update inline transform from "translate(...)" to `rest`
    // The browser sees the live transition and animates the snap.
    setIsDragging(false);
  }

  function onPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    startRef.current = null;
    setIsDragging(false);
    const el = ref.current;
    if (el) {
      el.style.transition = "transform 320ms cubic-bezier(0.22, 0.9, 0.3, 1)";
      el.style.transform = "";
      window.setTimeout(() => { if (el) el.style.transition = ""; }, 340);
    }
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  }

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className={`absolute touch-none ${
        dragging ? "deck-slot-dragging " : ""
      }${
        isTop || dragging
          ? "cursor-grab active:cursor-grabbing"
          : "cursor-default pointer-events-none"
      }`}
      style={{
        left: "50%",
        top: "50%",
        marginLeft: -CARD_W / 2,
        marginTop: -(CARD_W * 88 / 63) / 2,
        width: CARD_W,
        height: CARD_W * 88 / 63,
        // When dragging, JS sets el.style.transform directly. When not
        // dragging, React applies the rest transform — and because the
        // .deck-slot-dragging class is gone by then, the inline transition
        // below is already active, so the snap animation actually plays.
        transform: dragging ? undefined : rest,
        transition: "transform 380ms cubic-bezier(0.22, 0.9, 0.3, 1)",
        zIndex: dragging ? 999 : 100 - stackPos,
        // Cards stay at opacity 1 always. Cycled cards land on the back-of-
        // deck slot (clamped to stackPos = STACK_DEPTH - 1), where they
        // visually merge with already-cycled cards — only the topmost in
        // DOM order is ever drawn since they share transform + z-index.
        // This is what makes "snap back behind the deck" actually look like
        // snapping; the previous opacity:0 rule was making the card vanish.
        willChange: "transform",
      }}
    >
      <MagicCard
        card={{ kind: "scryfall", card: pulled.card, foil: pulled.foil }}
        faceUp
        width={CARD_W}
      />
    </div>
  );
}

/**
 * Tap-on-top in Reveal mode. Plays the same throw-out trajectory as a real
 * drag-and-release, then commits the cycle. The card visually leaves the
 * stage; React rerenders with the new cycle order; the opacity rule fades
 * the slot because it's now `behindStack`.
 *
 * No modal is opened — Reveal mode treats taps as "cycle one card".
 */
function animateCycleOut(el: HTMLDivElement, commitCycle: () => void) {
  const dir = Math.random() < 0.5 ? 1 : -1;
  el.style.transition =
    "transform 360ms cubic-bezier(0.4, 0, 0.2, 1), opacity 360ms ease";
  el.style.transform =
    `translate(${dir * 560}px, 80px) rotateZ(${dir * 22}deg) scale(0.88)`;
  el.style.opacity = "0";
  window.setTimeout(() => {
    commitCycle();
    if (el) {
      el.style.transition = "";
      el.style.transform = "";
      el.style.opacity = "";
    }
  }, 340);
}

/** Resting transform for a card at `stackPos` in the deck. The top sits flat;
 *  cards underneath get a randomized ±2° rotation (seeded by uid so it stays
 *  consistent across renders) plus a small vertical offset and scale falloff. */
function stackTransform(stackPos: number, uid: string): string {
  if (stackPos === 0) return "translate(0, 0) rotate(0deg) scale(1)";
  const rot = hashAngle(uid, 2);
  const ty = -2 - stackPos * 2;
  const scale = 1 - stackPos * 0.012;
  return `translate(0, ${ty}px) rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
}

/** Deterministic hash of `uid` mapped into [-maxDeg, +maxDeg]. */
function hashAngle(uid: string, maxDeg: number): number {
  let h = 2166136261;
  for (let i = 0; i < uid.length; i++) {
    h ^= uid.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Convert to [0, 1) then to [-1, 1)
  const u = (h >>> 0) / 0xffffffff;
  return (u * 2 - 1) * maxDeg;
}
