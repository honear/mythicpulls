"use client";

/**
 * Swipe-down-to-dismiss hook for bottom-sheet modals on mobile.
 *
 * Returns:
 *   - `bind` props to spread onto either the drag handle (grip bar)
 *     OR the whole sheet body — when bound to the sheet body, drags
 *     are only treated as dismiss-intent if the inner scroll container
 *     is parked at scrollTop=0 (the iOS pull-to-dismiss idiom). When
 *     not at scrollTop=0, the drag is left for the scroll container.
 *   - `style` to spread onto the sheet element itself, applying the
 *     in-flight `translateY` while the finger is down and a smooth
 *     transition when released (snap back or fly out).
 *   - `dragY` for any extra animation the caller might want to wire
 *     (e.g. fading the backdrop with drag distance).
 *
 * Touch-only — desktop users have a backdrop click + Esc to dismiss,
 * so mouse drags would just be confusing.
 *
 * The dismissal threshold defaults to 100px. Above that on pointerup
 * we call `onDismiss`; below, the sheet springs back to its rest
 * position.
 */

import { useCallback, useRef, useState } from "react";

interface UseSwipeDismissOptions {
  /** Called when the user releases past the dismissal threshold. */
  onDismiss: () => void;
  /** Minimum drag distance (px) that counts as a "dismiss" intent
   *  rather than a missed grab. Default 100. */
  threshold?: number;
  /** Optional scrollable container ref. When provided, a downward
   *  drag is only converted into a dismiss when the container is
   *  already at scrollTop=0 (otherwise the drag should scroll the
   *  content). When omitted (default), drags always count — use
   *  this for the grip handle, where scrolling isn't ambiguous. */
  scrollRef?: React.RefObject<HTMLElement | null>;
}

export function useSwipeDismiss({
  onDismiss,
  threshold = 100,
  scrollRef,
}: UseSwipeDismissOptions) {
  // Drag offset in px (always ≥ 0 — we only drag downward). Reset to
  // 0 when the user releases below threshold, or stays at the
  // dismissal target during the brief release-fly-out animation.
  const [dragY, setDragY] = useState(0);
  // Whether a pointerup just committed a dismissal — used to swap
  // the live drag transform for a "fly out the bottom" animation
  // during the brief window before the parent unmounts the modal.
  const [released, setReleased] = useState<"snap" | "dismiss" | null>(null);
  const startYRef = useRef<number | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  // When `scrollRef` is provided, this tracks whether the container
  // was scrolled at pointerdown. If it was, we hand the drag off to
  // the scroll container and never treat it as a dismiss — even if
  // the user scrolls back to the top mid-gesture, that gesture stays
  // a scroll until they release and start a new one.
  const startedScrolledRef = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return;
    // If a scroll container is wired up and the user starts the touch
    // while it's scrolled past the top, this gesture is a scroll —
    // not a dismiss. Mark the state and bail without capturing.
    if (scrollRef?.current && scrollRef.current.scrollTop > 0) {
      startedScrolledRef.current = true;
      startYRef.current = null;
      return;
    }
    startedScrolledRef.current = false;
    startYRef.current = e.clientY;
    pointerIdRef.current = e.pointerId;
    setReleased(null);
    // Capture the pointer so subsequent move/up events come to us
    // even if the finger drifts off the bound element. Skipped for
    // the sheet-body binding because capture there would steal
    // events from the inner scrollable content; only set it when
    // there's no scrollRef (i.e. the grip-handle binding).
    if (!scrollRef) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}
    }
  }, [scrollRef]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const start = startYRef.current;
    if (start === null || e.pointerId !== pointerIdRef.current) return;
    // If a scroll container is wired up, double-check that it's still
    // at scrollTop=0. The user may have started scrolling mid-drag
    // (e.g. by dragging upward first), in which case we cede the
    // gesture to the scroll container.
    if (scrollRef?.current && scrollRef.current.scrollTop > 0) {
      startYRef.current = null;
      setDragY(0);
      return;
    }
    const dy = e.clientY - start;
    // Only register downward drags. Slight upward jitter (e.g. user
    // adjusting their grip on the grip bar) clamps to 0 instead of
    // pulling the sheet up off its rest position.
    setDragY(dy > 0 ? dy : 0);
  }, [scrollRef]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const start = startYRef.current;
    startYRef.current = null;
    pointerIdRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    if (start === null) return;
    const dy = e.clientY - start;
    if (dy >= threshold) {
      // Fly out the bottom over ~200ms while parent unmounts the
      // modal. Using viewport height as the target so the animation
      // looks like the sheet exits the screen.
      setReleased("dismiss");
      if (typeof window !== "undefined") setDragY(window.innerHeight);
      // Delay the parent's unmount slightly so the slide-down has a
      // moment to play before the element is removed.
      window.setTimeout(() => onDismiss(), 180);
    } else {
      // Spring back to rest.
      setReleased("snap");
      setDragY(0);
    }
  }, [onDismiss, threshold]);

  const onPointerCancel = useCallback(() => {
    startYRef.current = null;
    pointerIdRef.current = null;
    setReleased("snap");
    setDragY(0);
  }, []);

  // Inline style for the sheet element. `transition: none` during the
  // live drag so the sheet follows the finger 1:1; a smooth
  // transition kicks in on release for snap-back or fly-out.
  const sheetStyle: React.CSSProperties = {
    transform: dragY ? `translateY(${dragY}px)` : undefined,
    transition:
      released === "snap"
        ? "transform 220ms cubic-bezier(0.22, 0.9, 0.3, 1)"
        : released === "dismiss"
          ? "transform 200ms cubic-bezier(0.4, 0, 0.2, 1)"
          : startYRef.current !== null
            ? "none"
            : undefined,
    // Hint to the compositor so the translate animates on the GPU.
    willChange: dragY ? "transform" : undefined,
  };

  return {
    /** Spread onto either the grip handle OR the sheet body. When
     *  spread onto the body, supply `scrollRef` so scrolled content
     *  yields the gesture back to the scroll container. */
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    },
    /** Spread onto the sheet element itself (transform + transition). */
    sheetStyle,
    dragY,
  };
}
