"use client";

/**
 * Touch-triggered card preview overlay. Centered on the viewport
 * (rather than anchored to a pointer position, like the desktop
 * `HoverPreview`) because the user's finger is on the card and any
 * anchored position would be occluded.
 *
 * Visual: a 280-340px MagicCard with a dimmed full-screen backdrop
 * behind it, both rendered via createPortal so they escape any
 * ancestor with backdrop-filter. Tapping anywhere on the backdrop
 * dismisses — but in practice consumers also dismiss programmatically
 * on the same pointerup that released the long-press hold.
 *
 * Use this for the mobile long-press "peek" — for the full tap-to-
 * open-modal path, see CardDetailModal / BinderCardModal instead.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MagicCard, type CardLike } from "./MagicCard";

interface Props {
  /** Either a full ScryfallCard (pack reveal, deck builder pool) or
   *  a "lite" art-URL-only entry (binder, where we don't keep the
   *  full card stored). MagicCard handles both via its `CardLike`
   *  discriminated union, so TouchPreview just forwards the shape. */
  card: CardLike;
  /** Optional dismiss handler — invoked on backdrop tap. Consumers
   *  also dismiss on pointerup at the source (the released finger),
   *  so this is a fallback for cases where the pointerup fires
   *  outside the originating element. */
  onDismiss?: () => void;
}

export function TouchPreview({ card, onDismiss }: Props) {
  // SSR-safe portal target. The hook returns null on first server
  // render; the effect flips mounted after hydration, at which
  // point the portal renders to document.body.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Dismiss when the user's long-press finger lifts anywhere on the
  // page. The pointerup event from the long-press release goes to
  // the originally captured element (the binder/deck card), NOT to
  // this overlay — so we listen globally on `document`. The capture
  // phase ensures we fire before any other handler, and the
  // pointercancel covers iOS edge cases where the system interrupts
  // (incoming call etc.).
  useEffect(() => {
    if (!onDismiss) return;
    const handle = () => onDismiss();
    document.addEventListener("pointerup", handle, { capture: true });
    document.addEventListener("pointercancel", handle, { capture: true });
    return () => {
      document.removeEventListener("pointerup", handle, { capture: true });
      document.removeEventListener("pointercancel", handle, { capture: true });
    };
  }, [onDismiss]);

  if (!mounted || typeof document === "undefined") return null;

  // Clamp the preview width to the smaller viewport dimension so it
  // fits comfortably on both portrait and landscape phones. 340 is
  // the max — beyond that the card starts dominating wider screens
  // where the desktop hover preview is already available.
  const previewW = Math.min(
    340,
    typeof window !== "undefined" ? Math.min(window.innerWidth - 40, 340) : 320,
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[2147483600] flex items-center justify-center anim-detail-fade"
      onPointerDown={onDismiss}
      // Lift above every other overlay including the site header
      // (z-30) and any modals (z-1200). The 2.1B is "max z-index"
      // territory, used to guarantee the peek can't be obscured.
    >
      {/* Dimmed full-screen backdrop. Tap to dismiss is wired on
          the outer wrapper via onPointerDown above, so the backdrop
          doesn't need its own handler — the entire overlay is one
          tap target. */}
      <div
        className="absolute inset-0 bg-black/72 backdrop-blur-sm"
        aria-hidden
      />
      <div
        className="relative pointer-events-none"
        style={{ width: previewW }}
      >
        <MagicCard
          card={card}
          faceUp
          width={previewW}
          holoEnabled={false}
        />
      </div>
    </div>,
    document.body,
  );
}
