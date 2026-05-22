"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Pointer-driven 3D tilt for a card-like element.
 *
 * The hook writes tilt + cursor-glare positions directly to CSS custom
 * properties on the element root, keeping React off the per-frame path.
 *
 * Generic over the element type so the same hook drives both the MagicCard
 * (HTMLDivElement) and the FannedPack body (HTMLDivElement) plus any future
 * surface — the consumer parameterizes T to match its ref target.
 *
 * CSS contract (consumed by `.card-mtg` and `.pack-tilt` in globals.css):
 *   --tilt-x        : X rotation in degrees (up/down lean)
 *   --tilt-y        : Y rotation in degrees (left/right lean)
 *   --glare-x       : cursor X position (0%..100%)
 *   --glare-y       : cursor Y position (0%..100%)
 *   --glare-opacity : 0..1
 *   --holo-opacity  : 0..1 (only set when `holographic` is true)
 *
 * Jitter notes:
 *   - We cache the bounding rect on pointerenter. Reading
 *     getBoundingClientRect on every move while the element is rotating
 *     in 3D feeds back into the cursor math and produces visible wobble.
 *   - We batch CSS-var writes via requestAnimationFrame. Pointer events
 *     can fire 2–3× per frame on high-refresh-rate displays; without rAF
 *     batching the browser issues redundant style invalidations and the
 *     compositing layer (especially for the pack's mix-blend-mode glare)
 *     can stutter under load.
 */
export function useCardTilt<T extends HTMLElement = HTMLDivElement>({
  maxTilt = 12,
  glare = true,
  enabled = true,
}: {
  maxTilt?: number;
  /** Reserved for future holographic gating — currently no-op. */
  holographic?: boolean;
  glare?: boolean;
  /** When false, the hook is a no-op (used when the card is face-down). */
  enabled?: boolean;
} = {}) {
  const ref = useRef<T | null>(null);
  const rectRef = useRef<DOMRect | null>(null);
  /** Latest cursor sample, written every pointermove and consumed at most
   *  once per animation frame by the rAF callback below. */
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  const apply = useCallback(
    (el: T, x: number, y: number) => {
      // Clamp to [0,1] so flick-outs that fire one stray move beyond the
      // edge don't briefly produce out-of-range tilts.
      const cx = x < 0 ? 0 : x > 1 ? 1 : x;
      const cy = y < 0 ? 0 : y > 1 ? 1 : y;
      const rotX = (0.5 - cy) * maxTilt;
      const rotY = (cx - 0.5) * maxTilt;
      el.style.setProperty("--tilt-x", `${rotX.toFixed(2)}deg`);
      el.style.setProperty("--tilt-y", `${rotY.toFixed(2)}deg`);
      el.style.setProperty("--glare-x", `${(cx * 100).toFixed(1)}%`);
      el.style.setProperty("--glare-y", `${(cy * 100).toFixed(1)}%`);
    },
    [maxTilt],
  );

  const scheduleApply = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = ref.current;
      const pending = pendingRef.current;
      if (!el || !pending) return;
      apply(el, pending.x, pending.y);
    });
  }, [apply]);

  const onPointerEnter = useCallback(
    (e: React.PointerEvent<T>) => {
      if (!enabled) return;
      const el = ref.current;
      if (!el) return;
      el.classList.add("is-tilting");
      if (glare) el.style.setProperty("--glare-opacity", "1");
      const rect = el.getBoundingClientRect();
      rectRef.current = rect;
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      // Initial frame: apply immediately so there's no centered flash
      // before the cursor-aligned tilt takes hold.
      apply(el, x, y);
    },
    [enabled, glare, apply],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<T>) => {
      if (!enabled) return;
      const el = ref.current;
      if (!el) return;
      // Defensive: pointerenter occasionally doesn't fire after hot reload
      // or when the cursor was already over the element when the handler
      // attached. Lazily snapshot the rect on first move if missing.
      if (!rectRef.current) {
        rectRef.current = el.getBoundingClientRect();
        el.classList.add("is-tilting");
        if (glare) el.style.setProperty("--glare-opacity", "1");
      }
      const rect = rectRef.current;
      pendingRef.current = {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
      };
      scheduleApply();
    },
    [enabled, glare, scheduleApply],
  );

  const onPointerLeave = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingRef.current = null;
    const el = ref.current;
    if (!el) return;
    el.classList.remove("is-tilting");
    el.style.setProperty("--tilt-x", "0deg");
    el.style.setProperty("--tilt-y", "0deg");
    el.style.setProperty("--glare-opacity", "0");
    rectRef.current = null;
  }, []);

  // Cancel any pending frame on unmount so we don't write to a detached
  // element after a React commit.
  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return { ref, onPointerEnter, onPointerMove, onPointerLeave };
}
