"use client";

import { useCallback, useRef } from "react";

/**
 * Mouse/pointer driven 3D tilt for a card element. Returns props you can
 * spread onto the card root: `onPointerEnter/Move/Leave`. The hook writes
 * the tilt directly to CSS custom properties on the element to keep React
 * out of the per-frame path.
 *
 * CSS contract:
 *   --tilt-x        :  X rotation in degrees
 *   --tilt-y        :  Y rotation in degrees
 *   --glare-x       :  cursor X position as %
 *   --glare-y       :  cursor Y position as %
 *   --glare-opacity :  0..1
 *   --holo-opacity  :  0..1 (only set if holographic = true)
 */
export function useCardTilt({
  maxTilt = 14,
  holographic = false,
  glare = true,
}: {
  maxTilt?: number;
  holographic?: boolean;
  glare?: boolean;
} = {}) {
  const ref = useRef<HTMLDivElement | null>(null);

  const onPointerEnter = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.add("is-tilting");
    if (glare) el.style.setProperty("--glare-opacity", "1");
    if (holographic) el.style.setProperty("--holo-opacity", "0.55");
  }, [glare, holographic]);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
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
    [maxTilt],
  );

  const onPointerLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.remove("is-tilting");
    el.style.setProperty("--tilt-x", "0deg");
    el.style.setProperty("--tilt-y", "0deg");
    el.style.setProperty("--glare-opacity", "0");
    if (holographic) el.style.setProperty("--holo-opacity", "0");
  }, [holographic]);

  return { ref, onPointerEnter, onPointerMove, onPointerLeave };
}
