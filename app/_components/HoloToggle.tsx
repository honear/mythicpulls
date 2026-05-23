"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

type HoloStyle = "shimmer" | "masked" | "off";

// Kept on the legacy `mythicpulls:` prefix — see lib/collection.ts for
// rationale. The project is now branded "Mythic Grounds" but
// localStorage keys stay stable so existing users' preferences survive.
const STORAGE_KEY = "mythicpulls:holo-style";

/**
 * Toggle that cycles between three holo treatments:
 *   - "shimmer" — the default conic-gradient rainbow
 *   - "masked"  — the conic shimmer pushed through a luminance mask of
 *                 the card art, so foil only shows in the LIGHT regions
 *                 (no shimmer over the black frame / text box). Bumped
 *                 ~50% more pronounced than the unmasked default.
 *   - "off"     — no holo overlay at all (foils still look like foils
 *                 in the binder via their `foil` flag, just no shimmer).
 *
 * The choice is persisted in localStorage and written to
 * <body data-holo="..."> so CSS rules key off it. Removing this
 * component + the data-holo CSS branches walks the experiment back.
 */
export function HoloToggle() {
  const [style, setStyle] = useState<HoloStyle>("shimmer");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "shimmer" || saved === "masked" || saved === "off") {
        setStyle(saved);
        document.body.dataset.holo = saved;
      } else {
        // Legacy values (e.g. "inverted") fall through to default.
        document.body.dataset.holo = "shimmer";
      }
    } catch {
      // localStorage blocked — just go with default.
    }
  }, []);

  function nextStyle(s: HoloStyle): HoloStyle {
    switch (s) {
      case "shimmer":
        return "masked";
      case "masked":
        return "off";
      case "off":
        return "shimmer";
    }
  }

  function cycle() {
    const next = nextStyle(style);
    setStyle(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {}
    document.body.dataset.holo = next;
  }

  const label = mounted
    ? style === "masked"
      ? "Masked"
      : style === "off"
        ? "Off"
        : "Shimmer"
    : "Holo";

  const sparkleColor = mounted
    ? style === "masked"
      ? "var(--accent-purple)"
      : style === "off"
        ? "var(--color-ink-muted)"
        : "var(--accent-purple-light)"
    : "var(--accent-purple-light)";

  return (
    <button
      onClick={cycle}
      aria-label={`Holo style: ${label}. Click to cycle through holo styles.`}
      title={`Holo: ${label} — click to try the next variant`}
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
