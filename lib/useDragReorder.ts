"use client";

import { useCallback, useRef, useState } from "react";

interface DragStart {
  pointerX: number;
  pointerY: number;
  index: number;
  lastX: number;
  lastT: number;
}

/**
 * Pointer-driven drag-to-reorder hook with an explicit click fallback.
 *
 * Spread the result of `bind(index)` onto your draggable element:
 *
 *     const bound = bind(idx);
 *     <li ref={bound.ref} {...bound}> ... </li>
 *
 * Behavior:
 *  - Movement under `threshold` px → tap, fires `onTap(index)` (if supplied).
 *    Use this for "click to flip" so the drag layer doesn't swallow taps.
 *  - Movement over the threshold → drag, with the card following the cursor
 *    1:1 and tilting based on instantaneous velocity.
 *  - On release over another item → `onReorder(from, to)`.
 *  - On release with no drop target → smooth spring-back via transition.
 */
export function useDragReorder({
  onReorder,
  onTap,
  threshold = 6,
}: {
  onReorder: (from: number, to: number) => void;
  /** Called on a press-release without enough movement to be a drag. */
  onTap?: (index: number) => void;
  threshold?: number;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const startRef = useRef<DragStart | null>(null);
  const elsRef = useRef<Map<number, HTMLElement>>(new Map());

  const findOverIndex = (clientX: number, clientY: number, selfIndex: number) => {
    for (const [idx, el] of elsRef.current) {
      if (idx === selfIndex) continue;
      const r = el.getBoundingClientRect();
      if (
        clientX >= r.left &&
        clientX <= r.right &&
        clientY >= r.top &&
        clientY <= r.bottom
      ) {
        return idx;
      }
    }
    return null;
  };

  const clearTransform = (el: HTMLElement, animate: boolean) => {
    if (animate) {
      el.style.transition = "transform 320ms cubic-bezier(0.22, 0.9, 0.3, 1)";
      el.style.transform = "";
      window.setTimeout(() => {
        el.style.transition = "";
      }, 360);
    } else {
      el.style.transition = "";
      el.style.transform = "";
    }
  };

  const bind = useCallback(
    (index: number) => ({
      ref: (node: HTMLElement | null) => {
        if (node) elsRef.current.set(index, node);
        else elsRef.current.delete(index);
      },
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        if (e.button !== 0 && e.pointerType === "mouse") return;
        const el = e.currentTarget;
        startRef.current = {
          pointerX: e.clientX,
          pointerY: e.clientY,
          index,
          lastX: e.clientX,
          lastT: performance.now(),
        };
        try {
          el.setPointerCapture(e.pointerId);
        } catch {}
        el.style.transition = "none";
      },
      onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
        const start = startRef.current;
        if (!start || start.index !== index) return;

        const dx = e.clientX - start.pointerX;
        const dy = e.clientY - start.pointerY;
        const dist2 = dx * dx + dy * dy;

        if (activeIndex === null && dist2 < threshold * threshold) return;
        if (activeIndex === null) setActiveIndex(index);

        const now = performance.now();
        const dt = Math.max(1, now - start.lastT);
        const vx = (e.clientX - start.lastX) / dt;
        const tiltZ = clamp(vx * 10, -8, 8);
        start.lastX = e.clientX;
        start.lastT = now;

        const el = e.currentTarget;
        el.style.transform =
          `translate(${dx}px, ${dy}px) rotateZ(${tiltZ.toFixed(2)}deg) scale(1.04)`;

        const o = findOverIndex(e.clientX, e.clientY, index);
        setOverIndex(o);
      },
      onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
        const start = startRef.current;
        startRef.current = null;
        const el = e.currentTarget;
        try {
          el.releasePointerCapture(e.pointerId);
        } catch {}
        const wasDragging = activeIndex !== null;
        const targetIdx = overIndex;
        setActiveIndex(null);
        setOverIndex(null);

        if (
          wasDragging &&
          start &&
          targetIdx !== null &&
          targetIdx !== start.index
        ) {
          clearTransform(el, false);
          onReorder(start.index, targetIdx);
        } else if (wasDragging) {
          clearTransform(el, true);
        } else {
          // Press-release with no drag → treat as a tap.
          clearTransform(el, false);
          onTap?.(index);
        }
      },
      onPointerCancel: (e: React.PointerEvent<HTMLElement>) => {
        startRef.current = null;
        const el = e.currentTarget;
        clearTransform(el, true);
        setActiveIndex(null);
        setOverIndex(null);
        try { el.releasePointerCapture(e.pointerId); } catch {}
      },
      "data-dragging": activeIndex === index ? "true" : undefined,
      "data-drop-target": overIndex === index ? "true" : undefined,
      style: {
        zIndex: activeIndex === index ? 50 : undefined,
      } as React.CSSProperties,
    }),
    [activeIndex, overIndex, onReorder, onTap, threshold],
  );

  return { bind, activeIndex, overIndex };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
