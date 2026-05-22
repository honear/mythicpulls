"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScryfallCard } from "./scryfall";

const HOVER_DELAY_MS = 200;

export interface HoverPreviewState {
  card: ScryfallCard;
  foil: boolean;
  x: number;
  y: number;
}

/**
 * Stateful hover-preview timer. armHover schedules a preview to appear
 * 200ms after the cursor lands on a card; pointermove RESTARTS the
 * timer (so a moving cursor never triggers — only a paused one).
 * clearHover cancels the timer and hides any active preview.
 *
 * Touch pointers are ignored — hover doesn't exist on touch devices.
 *
 * The hook owns the preview state. Consumers render <HoverPreview /> from
 * the `preview` field when non-null, and call armHover / clearHover from
 * card pointer handlers. Suppress the preview during interaction (e.g.,
 * drag start, mid-animation) by calling clearHover at the start of the
 * interaction.
 */
export function useHoverPreview() {
  const [preview, setPreview] = useState<HoverPreviewState | null>(null);
  const hoverTimerRef = useRef<number | null>(null);

  // Cleanup on unmount so a queued timer doesn't fire setState on a
  // dead component.
  useEffect(() => () => {
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
  }, []);

  const clearHover = useCallback(() => {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setPreview(null);
  }, []);

  const armHover = useCallback(
    (card: ScryfallCard, foil: boolean, e: React.PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
      const x = e.clientX;
      const y = e.clientY;
      hoverTimerRef.current = window.setTimeout(() => {
        setPreview({ card, foil, x, y });
      }, HOVER_DELAY_MS);
    },
    [],
  );

  return { preview, armHover, clearHover };
}
