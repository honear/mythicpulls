"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ScryfallCard } from "@/lib/scryfall";
import { MagicCard } from "./MagicCard";

const PREVIEW_W = 320;

interface Props {
  card: ScryfallCard;
  foil?: boolean;
  /** Cursor x in viewport coordinates — preview anchors near here. */
  x: number;
  /** Cursor y in viewport coordinates. */
  y: number;
}

/**
 * Hover preview overlay — a fixed-position MagicCard rendered at ~3×
 * thumbnail size, anchored next to the cursor. Portaled to document.body
 * so it escapes any ancestor with backdrop-filter (which creates a
 * containing block for position:fixed and would otherwise clip the
 * preview at the panel edge).
 *
 * Position auto-flips horizontally if the cursor is on the right edge of
 * the viewport (preview would overflow) and clamps vertically so it
 * always sits fully on-screen.
 */
export function HoverPreview({ card, foil = false, x, y }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted || typeof document === "undefined") return null;

  const cardH = (PREVIEW_W * 88) / 63;
  const margin = 18;
  const offsetX = 24;
  let left = x + offsetX;
  let top = y - cardH / 2;
  if (left + PREVIEW_W + margin > window.innerWidth) {
    left = x - PREVIEW_W - offsetX;
  }
  if (top < margin) top = margin;
  if (top + cardH + margin > window.innerHeight) {
    top = window.innerHeight - cardH - margin;
  }

  return createPortal(
    <div
      className="fixed pointer-events-none anim-detail-fade"
      style={{ left, top, width: PREVIEW_W, zIndex: 2147483600 }}
    >
      <MagicCard
        card={{ kind: "scryfall", card, foil }}
        faceUp
        width={PREVIEW_W}
        holoEnabled={false}
      />
    </div>,
    document.body,
  );
}
