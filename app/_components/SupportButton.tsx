"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Coffee, X } from "lucide-react";

/**
 * "Support" button + in-page Ko-fi tip panel.
 *
 * Keeps the donation flow on-site: clicking the button opens a modal
 * over the current page containing Ko-fi's widget iframe (with
 * `hidefeed=true` so the public feed / follow buttons / social cruft
 * are stripped, leaving just the tip form). The user never navigates
 * away from Mythic Grounds. The modal portals to `document.body` to
 * escape any `backdrop-filter` stacking context in the header — same
 * fix we applied to CardDetailModal and ExportModal.
 *
 * Variants:
 *   - "desktop": small glass pill matching the nav-bar height
 *   - "mobile":  full-width drawer row matching the hamburger sheet
 */
export function SupportButton({
  variant = "desktop",
}: {
  variant?: "desktop" | "mobile";
}) {
  const [open, setOpen] = useState(false);
  // Portal target only available client-side; defer until first mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Escape closes the modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Lock body scroll while the modal is up so the page underneath
  // doesn't scroll inside the Ko-fi panel.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const buttonClass =
    variant === "desktop"
      ? "inline-flex items-center gap-1.5 h-[38px] px-3 rounded-[10px] text-[13px] font-medium transition-colors hover:bg-white/10 border border-[var(--color-line)]"
      : "inline-flex items-center gap-2 h-11 px-4 rounded-[10px] text-[15px] font-medium border border-[var(--color-line)] hover:bg-white/5";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Support the developer on Ko-fi"
        className={buttonClass}
        style={{ color: "var(--color-fg)", fontFamily: "var(--font-ui)" }}
      >
        <Coffee
          className={variant === "desktop" ? "w-3.5 h-3.5" : "w-4 h-4"}
          style={{ color: "#ec4899" }}
        />
        {variant === "desktop" ? "Support" : "Support on Ko-fi"}
      </button>

      {open && mounted &&
        createPortal(
          <div
            className="fixed inset-0 z-[1200] flex items-center justify-center p-3 sm:p-4 anim-detail-fade"
            role="dialog"
            aria-modal="true"
            aria-label="Support the developer on Ko-fi"
          >
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="absolute inset-0 bg-black/70 backdrop-blur-md"
            />
            {/* Bare Ko-fi iframe — no wrapping header / dark chrome.
                  The iframe IS the popup. Dimensions clamped via `min()`
                  to fit any viewport without scrollbars:
                    width  = min(400, viewport − 24px outer padding)
                    height = min(680, viewport − 24px outer padding)
                  480×680 fits the Ko-fi tip form with `hidefeed=true`
                  comfortably — tier buttons, amount input, message
                  box all render without internal scroll. A floating
                  close button sits just outside the top-right corner
                  so the iframe owns its full content area. */}
            <div className="relative anim-detail-rise">
              <iframe
                id="kofiframe"
                src="https://ko-fi.com/honear/?hidefeed=true&widget=true&embed=true&preview=true"
                title="Ko-fi tip panel for honear"
                className="border-0 block"
                style={{
                  width: "min(400px, calc(100vw - 24px))",
                  height: "min(680px, calc(100vh - 24px))",
                  background: "#f9f9f9",
                  borderRadius: 14,
                  boxShadow:
                    "0 20px 60px -20px rgba(0,0,0,0.75), 0 2px 8px rgba(0,0,0,0.35)",
                }}
              />
              {/* Floating close button — sits half-overlapping the
                  iframe's top-right corner so it's always reachable
                  without leaning on Ko-fi's own UI to provide a
                  dismiss affordance (their embed has none). */}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="absolute -top-3 -right-3 grid place-items-center w-9 h-9 rounded-full transition-transform hover:scale-105"
                style={{
                  background: "rgba(20, 14, 42, 0.98)",
                  border: "1px solid var(--color-line)",
                  color: "var(--color-fg)",
                  boxShadow:
                    "0 6px 16px -4px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)",
                }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
