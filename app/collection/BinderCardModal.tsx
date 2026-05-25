"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, ShoppingBag, X } from "lucide-react";
import type { CollectionEntry } from "@/lib/collection";
import { safeExternalUrl } from "@/lib/safe-url";
import { getManaPoolCardUrl } from "@/lib/manapool";
import { useManaPoolSingle } from "@/lib/useManaPoolSingle";
import { getCardmarketCardUrl } from "@/lib/cardmarket";
import { useScryfallCardPrice } from "@/lib/useScryfallCardPrice";
import { useSwipeDismiss } from "@/lib/useSwipeDismiss";
import { MagicCard } from "@/app/_components/MagicCard";

/**
 * Binder-side equivalent of CardDetailModal. Same layout, but it reads
 * from a CollectionEntry instead of a full ScryfallCard — the binder
 * only persists a trimmed-down record per pull (no type_line, no
 * prices, no image_uris.normal), so we can't reuse CardDetailModal
 * directly without re-fetching the card from Scryfall.
 *
 * What it shows:
 *   - The stored art_crop rendered through MagicCard kind="lite"
 *   - Card name, rarity chip, foil chip, set/collector number chip
 *   - Buy on Mana Pool (purple, primary, live USD chip) + Buy on
 *     Cardmarket (glass, live EUR chip) + View on Scryfall (white)
 *
 * What's intentionally missing vs CardDetailModal:
 *   - Type line: not stored on CollectionEntry
 *   - TCGplayer market price headline: relies on a fetch we don't do
 *     here. The MoneyStrip in PackOpener already shows it at pull
 *     time; once a card lands in the binder it's "kept", not
 *     "evaluated". Click "View on Scryfall" for the live figure.
 *
 * Portaled to document.body to escape the header's backdrop-filter
 * containing block (see AGENTS.md modal conventions).
 */

interface Props {
  entry: CollectionEntry | null;
  onClose: () => void;
}

export function BinderCardModal({ entry, onClose }: Props) {
  // Escape to close.
  useEffect(() => {
    if (!entry) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entry, onClose]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!entry) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [entry]);

  // SSR-safe portal target — render nothing until the client mounts so
  // the portal call doesn't crash on the server.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Live Mana Pool price for the inline pill on the Mana Pool buy
  // button. Hooks handle undefined gracefully so it's safe to call
  // before we bail on a closed modal.
  const { data: mpPrice } = useManaPoolSingle(entry?.cardId, entry?.foil);
  // Scryfall EUR price for the Cardmarket button chip — binder
  // entries don't store the original price block, so we look it up by
  // Scryfall ID at modal open time. Cached in-memory so repeat opens
  // skip the network round trip.
  const { data: sfPrice } = useScryfallCardPrice(entry?.cardId, entry?.foil);
  // Swipe-down-to-dismiss for the mobile bottom sheet. Bound to the
  // entire sheet body (with the sheet's own scroll ref) so a pull-
  // down from anywhere dismisses the modal when content is scrolled
  // to the top — vertical scrolling still works otherwise. Pulling
  // past 100px closes the modal.
  const sheetRef = useRef<HTMLDivElement>(null);
  const swipe = useSwipeDismiss({ onDismiss: onClose, scrollRef: sheetRef });

  if (!entry || !mounted) return null;

  const scryfallHref = safeExternalUrl(
    `https://scryfall.com/card/${encodeURIComponent(
      entry.setCode.toLowerCase(),
    )}/${encodeURIComponent(entry.collectorNumber)}`,
  );
  const cmHref = safeExternalUrl(getCardmarketCardUrl(entry.name));
  const mpHref = safeExternalUrl(
    getManaPoolCardUrl({
      set: entry.setCode,
      collector_number: entry.collectorNumber,
    }),
  );
  const mpUsd =
    mpPrice?.bestUsd != null ? `$${mpPrice.bestUsd.toFixed(2)}` : null;
  const eurChip =
    sfPrice?.eur != null ? `€${sfPrice.eur.toFixed(2)}` : null;

  const node = (
    <div
      className="fixed inset-0 z-[1200] flex items-end sm:items-center justify-center px-0 sm:px-4 py-0 sm:py-8 overflow-y-auto anim-detail-fade"
      data-modal-scroll
      role="dialog"
      aria-modal="true"
      aria-label={`${entry.name} details`}
    >
      {/* Backdrop */}
      <button
        className="fixed inset-0 bg-black/70 backdrop-blur-md"
        onClick={onClose}
        aria-label="Close details"
      />

      {/* Sheet wrapper — mirrors CardDetailModal's mobile bottom-sheet
          treatment. Anchored to the bottom on phones with a swipe-
          down dismiss gesture on the grip; floating in the center on
          sm+ with the original animation. See that file for details. */}
      <div
        ref={sheetRef}
        className="relative w-full sm:max-w-3xl max-h-[92dvh] sm:max-h-none overflow-y-auto sm:overflow-visible anim-sheet-rise sm:anim-detail-rise px-4 pt-4 pb-6 sm:p-0 my-auto bg-[var(--color-bg)] sm:bg-transparent rounded-t-3xl sm:rounded-none border-t border-white/5 sm:border-0"
        data-modal-scroll
        style={swipe.sheetStyle}
        {...swipe.bind}
        // Tap-outside-content dismissal: any click on the sheet
        // wrapper itself (padding / grip / gaps) closes the modal.
        // The card image and info panel each stop propagation so
        // taps on actual content stay open. Matches the user's
        // mental model of "tap anywhere besides the card and the
        // section underneath to close".
        onClick={onClose}
      >
        {/* Bottom-sheet drag handle. Visual affordance for the swipe-
            down dismiss; the actual gesture is bound to the entire
            sheet wrapper (with the iOS pull-to-dismiss idiom — only
            fires when scrollTop=0). Hidden at sm+. */}
        <div
          aria-hidden
          className="sm:hidden flex justify-center -mt-1 mb-2 py-2 pointer-events-none"
        >
          <div className="w-12 h-1.5 rounded-full bg-white/25" />
        </div>
        <div className="grid md:grid-cols-[auto_1fr] gap-4 md:gap-10">
        {/* Card image — uses the kind="lite" path so we don't need a
            full ScryfallCard. Width tracks the existing CardDetailModal
            responsive sizing. The inner stopPropagation wrapper is
            sized to the card itself (md:contents collapses on desktop
            so the layout is unchanged) — tapping in the empty space
            beside the centered card on phones still bubbles to the
            sheet and dismisses. */}
        <div className="flex justify-center md:block">
          {/* w-fit shrinks the stop-prop wrapper to exactly the
              card's width on mobile so taps beside the centered
              card bubble to the sheet (and dismiss). md:contents
              collapses the wrapper out of desktop layout while
              still letting events flow through. */}
          <div
            onClick={(ev) => ev.stopPropagation()}
            className="w-fit md:contents"
          >
            <BinderDetailCard entry={entry} />
          </div>
        </div>

        {/* Info panel — stop propagation so taps inside the panel
            (text, chips, buttons) never bubble to the sheet's
            onClick={onClose}. Real interactive elements inside
            (buy links, close button) still fire their own
            handlers before propagation is stopped. */}
        <div
          onClick={(ev) => ev.stopPropagation()}
          className="liquid-panel rounded-2xl p-4 sm:p-6 md:p-7 flex flex-col gap-4 sm:gap-5 max-w-md self-center w-full"
        >
          <div>
            {/* Headline size dialed in for mobile sheet width. The
                previous text-2xl (24px) wrapped multi-line card names
                like "Tamiyo, Inquisitive Student" to three lines on a
                320px-wide panel; bumped down to text-xl on mobile and
                added `balance` so the line breaks land more evenly. */}
            <h2 className="font-display text-xl sm:text-3xl md:text-4xl text-[var(--color-fg)] leading-tight balance">
              {entry.name}
            </h2>
          </div>

          <div className="flex flex-wrap gap-2">
            <RarityChip rarity={entry.rarity} />
            {entry.foil && (
              <span className="label-caps px-2.5 py-1 rounded-full bg-[var(--color-rarity-bonus)] text-white">
                Foil
              </span>
            )}
            <span className="label-caps px-2.5 py-1 rounded-full liquid-glass text-[var(--color-fg)]">
              {entry.setCode.toUpperCase()} · #{entry.collectorNumber}
            </span>
          </div>

          {/* Artist credit, live-fetched via useScryfallCardPrice
              alongside the EUR price. Mirrors CardDetailModal's
              treatment. Conditionally rendered so binder entries on
              networks where the fetch fails still display cleanly. */}
          {sfPrice?.artist && (
            <p
              className="text-[12px] text-[var(--color-ink-muted)] -mt-1"
              style={{ fontFamily: "var(--font-ui)" }}
            >
              Art by{" "}
              <span className="text-[var(--color-fg)]/85">{sfPrice.artist}</span>
            </p>
          )}

          <div className="flex flex-wrap gap-2 mt-2">
            {mpHref && (
              <a
                href={mpHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-[var(--accent-purple)] text-white text-sm font-semibold hover:brightness-110 transition-all"
              >
                <ShoppingBag className="w-3.5 h-3.5" /> Buy on Mana Pool
                {mpUsd && (
                  <span className="px-1.5 py-0.5 rounded-full bg-white/20 text-[12px] font-semibold tabular-nums">
                    {mpUsd}
                  </span>
                )}
              </a>
            )}
            {cmHref && (
              <a
                href={cmHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-white text-[var(--color-bg)] text-sm font-semibold hover:bg-white/90 transition-colors"
              >
                <ShoppingBag className="w-3.5 h-3.5" /> Buy on Cardmarket
                {/* EUR price chip — live-fetched via Scryfall when the
                    modal opens (binder entries don't store the price
                    block; see useScryfallCardPrice). The chip uses a
                    translucent-dark fill so it reads cleanly against
                    the white button. */}
                {eurChip && (
                  <span className="px-1.5 py-0.5 rounded-full bg-[var(--color-bg)]/10 text-[12px] font-semibold tabular-nums">
                    {eurChip}
                  </span>
                )}
              </a>
            )}
            {scryfallHref && (
              <a
                href={scryfallHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full liquid-glass text-[var(--color-fg)] text-sm font-semibold hover:brightness-110 transition-all"
              >
                <ExternalLink className="w-3.5 h-3.5" /> View on Scryfall
              </a>
            )}
            <button
              onClick={onClose}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full btn-hero-secondary liquid-glass text-sm font-semibold"
            >
              <X className="w-3.5 h-3.5" /> Close
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}

/**
 * Render the modal's hero card at a viewport-fit width — same clamp as
 * CardDetailModal's ResponsiveDetailCard but reads from a
 * CollectionEntry via MagicCard's "lite" mode.
 */
function BinderDetailCard({ entry }: { entry: CollectionEntry }) {
  const [w, setW] = useState(320);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const compute = () => {
      const avail = window.innerWidth - 32;
      setW(Math.max(220, Math.min(320, avail)));
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);
  return (
    <MagicCard
      card={{
        kind: "lite",
        name: entry.name,
        setCode: entry.setCode,
        collectorNumber: entry.collectorNumber,
        art: entry.image,
        rarity: entry.rarity,
        foil: entry.foil,
      }}
      faceUp
      width={w}
    />
  );
}

function RarityChip({ rarity }: { rarity: string }) {
  const colors: Record<string, string> = {
    common: "var(--color-rarity-common)",
    uncommon: "var(--color-rarity-uncommon)",
    rare: "var(--color-rarity-rare)",
    mythic: "var(--color-rarity-mythic)",
    special: "var(--color-rarity-bonus)",
    bonus: "var(--color-rarity-bonus)",
  };
  const c = colors[rarity] ?? "var(--color-rarity-common)";
  const isLight = rarity === "uncommon" || rarity === "common";
  return (
    <span
      className="label-caps px-2.5 py-1 rounded-full"
      style={{
        background: c,
        color: isLight ? "var(--color-bg)" : "white",
      }}
    >
      {rarity}
    </span>
  );
}
