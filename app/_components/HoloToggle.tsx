"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

type HoloStyle = "shimmer" | "off";

// Kept on the legacy `mythicpulls:` prefix — see lib/collection.ts for
// rationale. The project is now branded "Mythic Grounds" but
// localStorage keys stay stable so existing users' preferences survive.
const STORAGE_KEY = "mythicpulls:holo-style";

/**
 * Two-state foil toggle: shimmer on or off.
 *
 *   - "shimmer" → "Foil On"  — the conic-gradient rainbow overlay
 *                              shown over traditional-foil cards.
 *   - "off"     → "Foil Off" — no shimmer overlay anywhere (the foil
 *                              flag is still respected elsewhere in
 *                              the app — e.g. binder badges — just no
 *                              animated overlay on revealed cards).
 *
 * The earlier "masked" variant was removed; legacy localStorage values
 * of "masked" (and any other older value like "inverted") get coerced
 * back to the default "shimmer" so existing users' setting doesn't
 * silently end up in an undefined state.
 *
 * The choice is persisted in localStorage and written to
 * <body data-holo="..."> so CSS rules key off it.
 */
export function HoloToggle() {
  const [style, setStyle] = useState<HoloStyle>("shimmer");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "shimmer" || saved === "off") {
        setStyle(saved);
        document.body.dataset.holo = saved;
      } else {
        // Anything else (including the retired "masked" value, or older
        // "inverted") falls through to the shimmer default.
        document.body.dataset.holo = "shimmer";
        if (saved && saved !== "shimmer") {
          // Persist the coercion so we don't keep stepping through this
          // branch on every load for users with stale values.
          try {
            window.localStorage.setItem(STORAGE_KEY, "shimmer");
          } catch {}
        }
      }
    } catch {
      // localStorage blocked — just go with default.
    }
  }, []);

  function toggle() {
    const next: HoloStyle = style === "shimmer" ? "off" : "shimmer";
    setStyle(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {}
    document.body.dataset.holo = next;
  }

  const label = mounted ? (style === "off" ? "Foil Off" : "Foil On") : "Foil";

  const sparkleColor = mounted
    ? style === "off"
      ? "var(--color-ink-muted)"
      : "var(--accent-purple-light)"
    : "var(--accent-purple-light)";

  return (
    <button
      onClick={toggle}
      aria-pressed={style === "shimmer"}
      aria-label={`Foil shimmer: ${label}. Click to toggle.`}
      title={`Foil shimmer ${style === "shimmer" ? "on" : "off"} — click to toggle`}
      className="inline-flex items-center gap-1.5 h-[38px] px-3 rounded-[10px] text-[12px] font-medium transition-colors hover:bg-white/10 border border-[var(--color-line)]"
      style={{
        color: "var(--color-ink)",
        fontFamily: "var(--font-ui)",
      }}
    >
      <Sparkles className="w-3.5 h-3.5" style={{ color: sparkleColor }} />
      {label}
    </button>
  );
}
