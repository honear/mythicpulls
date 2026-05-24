"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
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

const CARD_W_DESKTOP = 320;
const CARD_W_MOBILE = 240;
const STACK_DEPTH = 5;           // visible cards at any time
const THRESHOLD = 6;             // px before press becomes a drag
const COMMIT_DIST = 40;          // px before the deck cycles
const STAGE_PAD_DESKTOP = 80;
const STAGE_PAD_MOBILE = 24;

/**
 * Media-query hook — true when viewport is narrower than the Tailwind
 * `sm` breakpoint (640px). The reveal deck rerenders at the new size and
 * the drag math (THRESHOLD / COMMIT_DIST stay in px) keeps working since
 * those are device-relative, not card-relative.
 */
function useIsMobile(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 639px)");
    const onChange = () => setM(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return m;
}

/**
 * Find the bounding rect of the nearest ancestor flagged as the reveal
 * canvas. PackOpener / SealedRun mark their main panel with
 * `data-deck-canvas`, and DeckSlot uses that rect to decide when a drag
 * has been thrown out — replacing the older fixed-radius THROW_DIST.
 *
 * If no canvas ancestor is found (shouldn't happen in practice) the auto-
 * throw is disabled and the user has to release normally — safer than
 * guessing.
 */
function findCanvasRect(el: HTMLElement): DOMRect | null {
  const canvas = el.closest("[data-deck-canvas]") as HTMLElement | null;
  return canvas ? canvas.getBoundingClientRect() : null;
}

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
  const isMobile = useIsMobile();
  const CARD_W = isMobile ? CARD_W_MOBILE : CARD_W_DESKTOP;
  const STAGE_PAD = isMobile ? STAGE_PAD_MOBILE : STAGE_PAD_DESKTOP;
  const [cycleOrder, setCycleOrder] = useState<string[]>(() =>
    pulled.map((p) => p.uid),
  );
  const [draggingUid, setDraggingUid] = useState<string | null>(null);
  /** Uids that have been the top of the deck at least once. Starts with the
   *  initial top, since it's immediately visible. */
  const [seen, setSeen] = useState<Set<string>>(
    () => new Set(pulled.length ? [pulled[0].uid] : []),
  );
  /** The uid of the last unseen card, captured the moment `seen` first
   *  reaches `pulled.length`. While this is set, the deck is in
   *  "awaiting-dismiss" mode — only `lastUid` is visible, the back pile
   *  fades away, and we wait for the user to drag or tap this card
   *  before firing onAllRevealed (which switches the view to Grid). */
  const [lastUid, setLastUid] = useState<string | null>(null);

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
    // Reset awaiting-dismiss state on a new pack. If only ONE card was
    // pulled (edge case), that lone card IS the final card.
    setLastUid(pulled.length === 1 ? pulled[0].uid : null);
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
        // When the LAST unseen card has just become the top, freeze in
        // "awaiting-dismiss" mode — don't auto-switch. The user will
        // explicitly drag or tap this card to acknowledge it.
        if (out.size >= pulled.length) {
          setLastUid(newTop);
        }
        return out;
      });
      return next;
    });
  }

  /** Called from DeckSlot when the user explicitly dismisses the final
   *  (last-unseen) card via drag or tap.
   *
   *  We deliberately do NOT setLastUid(null) here: the parent's
   *  onAllRevealed callback flips viewMode to "grid", which unmounts the
   *  entire CardDeck on the next commit. If we cleared lastUid first the
   *  previously-hidden back-pile would flash visible for a frame before
   *  the view actually switched. By going straight to onAllRevealed,
   *  the unmount happens before any intermediate state can paint. */
  function dismissFinal() {
    onAllRevealedRef.current?.();
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
        Drag (or click) the top card to send it to the back
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
          const isFinalCard = lastUid !== null && uid === lastUid;
          // Once we're in "awaiting final dismiss" mode, fade the back-pile
          // so the lone last card sits clean on the stage. Exemption: if the
          // user is mid-drag when we enter this mode (because the drag that
          // committed the cycle just made the final card the new top), keep
          // the dragged card visible until they release. Otherwise it would
          // vanish under the cursor on the same frame the final card lifts.
          const hide =
            lastUid !== null && uid !== lastUid && uid !== draggingUid;
          return (
            <DeckSlot
              key={uid}
              pulled={p}
              cardW={CARD_W}
              stackPos={Math.min(i, STACK_DEPTH - 1)}
              behindStack={i >= STACK_DEPTH}
              isTop={i === 0}
              isFinalCard={isFinalCard}
              hide={hide}
              onCommitCycle={() => sendToBack(uid)}
              onDragStateChange={(d) => setDraggingUid(d ? uid : null)}
              onFinalDismiss={dismissFinal}
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
  pulled, cardW, stackPos, behindStack, isTop, isFinalCard, hide,
  onCommitCycle, onDragStateChange, onFinalDismiss,
}: {
  pulled: PulledCard;
  /** Card render width, scaled per viewport by the parent. */
  cardW: number;
  stackPos: number;
  /** When true, the card has cycled past the visible window; it should
   *  finish its animation toward the back, then fade out. */
  behindStack: boolean;
  isTop: boolean;
  /** True if this slot holds the last-unseen card and we're waiting for
   *  the user to explicitly dismiss it. */
  isFinalCard: boolean;
  /** True if this slot should fade out — used to clear the back-pile while
   *  the user finishes interacting with the final card. */
  hide: boolean;
  onCommitCycle: () => void;
  onDragStateChange: (dragging: boolean) => void;
  /** Called when the user drags or taps the final card past the threshold —
   *  the parent uses this to switch the view to Grid. */
  onFinalDismiss?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const committedRef = useRef(false);
  const startRef = useRef<{ x: number; y: number; lastX: number; lastT: number } | null>(null);
  /** Bounding rect of the reveal canvas (the ancestor with
   *  data-deck-canvas). Captured once on pointerDown so a cursor crossing
   *  any edge of it can trigger the auto-throw — replaces the older
   *  fixed-radius THROW_DIST behaviour which felt too eager. */
  const canvasRectRef = useRef<DOMRect | null>(null);

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
    // Snapshot the canvas rect once. The auto-throw fires the moment the
    // cursor crosses any edge of this rect; reading it per-move would be
    // wasted work since the canvas doesn't move during a drag.
    canvasRectRef.current = findCanvasRect(el);
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
    // BUT skip this for the final card — we don't want to cycle the deck,
    // we want to dismiss it (handled on pointer release).
    if (!isFinalCard && !committedRef.current && dist2 >= COMMIT_DIST * COMMIT_DIST) {
      committedRef.current = true;
      onCommitCycle();
    }

    // Auto-throw on canvas exit. The instant the cursor leaves the reveal
    // panel (the ancestor flagged with data-deck-canvas) we treat the drag
    // as a deliberate fling:
    //  • Final card → dismiss (animate out + onFinalDismiss → view switch).
    //  • Non-final  → the cycle is already committed (it crossed
    //    COMMIT_DIST inside the canvas); play the throw-out trajectory so
    //    the card doesn't sit invisible-past-the-edge under the cursor
    //    waiting for a release.
    // Pointer capture is released so any further motion is ignored. The
    // throw direction follows whichever edge the cursor exited through
    // (left/right horizontal, top/bottom vertical) so the card visually
    // flies off the side the user dragged it toward.
    const canvas = canvasRectRef.current;
    if (canvas) {
      const outsideX = e.clientX < canvas.left || e.clientX > canvas.right;
      const outsideY = e.clientY < canvas.top || e.clientY > canvas.bottom;
      if (outsideX || outsideY) {
        const el2 = ref.current;
        startRef.current = null;
        setIsDragging(false);
        if (el2) {
          try { el2.releasePointerCapture(e.pointerId); } catch {}
          const dirX =
            e.clientX > canvas.right ? 1
              : e.clientX < canvas.left ? -1
                : Math.sign(e.clientX - start.x) || 1;
          if (isFinalCard) {
            animateCycleOut(el2, () => onFinalDismiss?.(), true, dirX as 1 | -1);
          } else {
            animateCycleOut(el2, () => {}, false, dirX as 1 | -1);
          }
        }
        return;
      }
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
    canvasRectRef.current = null;
    const el = ref.current;
    if (!el) { setIsDragging(false); return; }
    try { el.releasePointerCapture(e.pointerId); } catch {}

    if (!start) { setIsDragging(false); return; }

    if (!dragging) {
      // Pure tap. In final-card mode → dismiss + switch view. Otherwise
      // animate the cycle out — same path the drag-release takes, so
      // tap and drag end with the same fly-off motion.
      if (isFinalCard) {
        animateCycleOut(el, () => onFinalDismiss?.(), true);
      } else {
        animateCycleOut(el, onCommitCycle);
      }
      return;
    }

    // Real drag release.
    if (isFinalCard) {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const movedFar = dx * dx + dy * dy >= COMMIT_DIST * COMMIT_DIST;
      if (movedFar) {
        // Acknowledge the final card — animate it out and switch to Grid.
        animateCycleOut(el, () => onFinalDismiss?.(), true);
        setIsDragging(false);
        return;
      }
      // Drag was too short — spring back, but don't dismiss yet.
      setIsDragging(false);
      return;
    }

    // Standard drag release: DON'T clear the inline transform here. Doing
    // so would reset transform to identity in the previous frame (when
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
        (isTop || dragging) && !hide
          ? "cursor-grab active:cursor-grabbing"
          : "cursor-default pointer-events-none"
      }`}
      style={{
        left: "50%",
        top: "50%",
        marginLeft: -cardW / 2,
        marginTop: -(cardW * 88 / 63) / 2,
        width: cardW,
        height: cardW * 88 / 63,
        // When dragging, JS sets el.style.transform directly. When not
        // dragging, React applies the rest transform — and because the
        // .deck-slot-dragging class is gone by then, the inline transition
        // below is already active, so the snap animation actually plays.
        transform: dragging ? undefined : rest,
        transition:
          "transform 380ms cubic-bezier(0.22, 0.9, 0.3, 1), opacity 420ms ease",
        zIndex: dragging ? 999 : 100 - stackPos,
        // Final-card mode: every slot that ISN'T the last card fades out
        // so the lone last card sits clean. Pointer-events are also
        // disabled via the className when hide=true.
        opacity: hide ? 0 : 1,
        willChange: "transform, opacity",
      }}
    >
      <MagicCard
        card={{ kind: "scryfall", card: pulled.card, foil: pulled.foil }}
        faceUp
        width={cardW}
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
 *
 * `keepFinalState`: when true, we leave the off-stage transform + opacity:0
 * inline after the animation completes. The normal (non-final) path needs
 * the cleanup so the card can spring back into its new stack position; the
 * final-dismiss path skips the cleanup because the parent's view switch
 * unmounts this element on the next React commit. Without this flag, the
 * window between the cleanup running and React unmounting CardDeck shows
 * the dismissed card flashing back at the centered default-transform
 * position for a single frame.
 */

function animateCycleOut(
  el: HTMLDivElement,
  commitCycle: () => void,
  keepFinalState = false,
  direction?: 1 | -1,
) {
  // Caller may pass an explicit direction (e.g. the side of the canvas the
  // cursor exited through); fall back to random for tap-out paths where
  // there is no meaningful direction.
  const dir = direction ?? (Math.random() < 0.5 ? 1 : -1);
  el.style.transition =
    "transform 360ms cubic-bezier(0.4, 0, 0.2, 1), opacity 360ms ease";
  el.style.transform =
    `translate(${dir * 560}px, 80px) rotateZ(${dir * 22}deg) scale(0.88)`;
  el.style.opacity = "0";
  window.setTimeout(() => {
    if (keepFinalState || !el) {
      // Final-dismiss path leaves the off-stage state intact — the
      // parent's view switch unmounts this CardDeck on the next React
      // commit, so any cleanup would just flash a centered card for a
      // single frame.
      commitCycle();
      return;
    }
    // Cleanup choreography. Two competing facts:
    //   - We need to clear our inline transform/opacity so React's
    //     style prop (back-of-stack rest, opacity 1) becomes the source
    //     of truth for the card's resting position.
    //   - We need React to have committed the new cycle order BEFORE
    //     we re-enable transitions; otherwise the cleared transform
    //     resolves to centered identity, React then writes the new
    //     back-of-stack rest, and the JSX-default 380ms transition
    //     animates the card from centered → back. That mid-flight
    //     position is visible for the duration of the snap → the
    //     "flash" the user sees right after the card leaves.
    //
    // Solution:
    //   1. Disable transitions so any change in the next few ms is a
    //      teleport, not an animation.
    //   2. flushSync the cycle commit so React writes the new transform
    //      to el.style.transform synchronously, in the same JS turn.
    //   3. Force a reflow to commit the React-written value to the
    //      render tree.
    //   4. Restore transitions so future moves (e.g. this slot becoming
    //      the top again on a later cycle) animate normally.
    //
    // The element's inline transform is overwritten by React's flush in
    // step 2; we don't have to clear it ourselves. Opacity IS cleared
    // here because the JSX style prop doesn't manage it — leaving
    // opacity:0 inline would keep the back-of-stack card invisible.
    el.style.transition = "none";
    el.style.opacity = "";
    flushSync(commitCycle);
    // After flushSync, React has rerendered with the new cycleOrder.
    // The DeckSlot for this uid is now at the last position; its
    // `rest` transform writes back-of-stack via the JSX style prop,
    // which goes through React's reconciler and updates
    // el.style.transform. The forced reflow commits both opacity and
    // transform to the render tree before we restore transitions.
    void el.offsetHeight;
    el.style.transition = "";
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
