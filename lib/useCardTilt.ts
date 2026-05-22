"use client";

import { useCallback, useRef } from "react";

/**
 * Pointer-driven 3D tilt for a card element.
 *
 * The hook writes tilt + cursor-glare positions directly to CSS custom
 * properties on the element root, keeping React off the per-frame path.
 *
 * CSS contract (consumed by .card-mtg in globals.css):
 *   --tilt-x        : X rotation in degrees (up/down lean)
 *   --tilt-y        : Y rotation in degrees (left/right lean)
 *   --glare-x       : cursor X position (0%..100%)
 *   --glare-y       : cursor Y position (0%..100%)
 *   --glare-opacity : 0..1
 *   --holo-opacity  : 0..1 (only set when `holographic` is true)
 */
export function useCardTilt({
  maxTilt = 8,
  holographic = false,
  glare = true,
  enabled = true,
}: {
  maxTilt?: number;
  holographic?: boolean;
  glare?: boolean;
  /** When false, the hook is a no-op (used when the card is face-down). */
  enabled?: boolean;
} = {}) {
  const ref = useRef<HTMLDivElement | null>(null);

  const onPointerEnter = useCallback(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    el.classList.add("is-tilting");
    if (glare) el.style.setProperty("--glare-opacity", "1");
    // Holo shimmer is now driven by CSS default — the hook no longer
    // gates it on hover so holographic cards always glow softly.
  }, [glare, enabled]);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!enabled) return;
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      const rotX = (0.5 - y) * maxTilt;
      const rotY = (x - 0.5) * maxTilt;
      el.style.setProperty("--tilt-x", `${rotX.toFixed(2)}deg`);
      el.style.setProperty("--tilt-y", `${rotY.toFixed(2)}deg`);
      el.style.setProperty("--glare-x", `${(x * 100).toFixed(1)}%`);
      el.style.setProperty("--glare-y", `${(y * 100).toFixed(1)}%`);
    },
    [maxTilt, enabled],
  );

  const onPointerLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.remove("is-tilting");
    el.style.setProperty("--tilt-x", "0deg");
    el.style.setProperty("--tilt-y", "0deg");
    el.style.setProperty("--glare-opacity", "0");
    // Holo stays on — never reset --holo-opacity here.
  }, []);

  return { ref, onPointerEnter, onPointerMove, onPointerLeave };
}
