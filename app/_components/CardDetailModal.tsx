"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, ShoppingBag, X } from "lucide-react";
import type { ScryfallCard } from "@/lib/scryfall";
import { getCardImage, getDisplayPrice } from "@/lib/scryfall";
import { safeExternalUrl } from "@/lib/safe-url";
import { getManaPoolCardUrl } from "@/lib/manapool";
import { useManaPoolSingle } from "@/lib/useManaPoolSingle";
import { getCardmarketCardUrl } from "@/lib/cardmarket";
import { useSwipeDismiss } from "@/lib/useSwipeDismiss";
import { MagicCard } from "./MagicCard";

interface Props {
  card: ScryfallCard | null;
  foil?: boolean;
  /** Slot label from the pack recipe (e.g., "Rare / Mythic" or
   *  "Mystical Archive"). Currently unused — the rarity chip in the
   *  info panel conveys the same information. Kept on the prop so
   *  PackOpener doesn't need to change when this lights back up. */
  slotLabel?: string;
  onClose: () => void;
}

export function CardDetailModal({ card, foil, onClose }: Props) {
  // Close on Escape.
  useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, onClose]);

  // Lock body scroll while modal is open.
  useEffect(() => {
    if (!card) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [card]);

  // Mana Pool live price for the inline "Buy on Mana Pool · $X.XX" pill.
  // Hook is called every render but only fires a network request on the
  // first open per (cardId, foil) — subsequent opens hit its in-memory
  // cache. Safe to call unconditionally with card?.id (the hook no-ops
  // when scryfallId is undefined).
  const { data: mpPrice } = useManaPoolSingle(card?.id, foil);
  // Swipe-down-to-dismiss for the mobile bottom-sheet presentation.
  // We bind the swipe gesture to the entire sheet body (not just the
  // grip handle) and pass the sheet's own scroll ref — the hook only
  // converts a downward drag into a dismiss when `scrollTop === 0`,
  // so vertical scrolling on scrollable content still works. Touch-
  // only — desktop users still dismiss via backdrop click / Esc.
  const sheetRef = useRef<HTMLDivElement>(null);
  const swipe = useSwipeDismiss({ onDismiss: onClose, scrollRef: sheetRef });

  if (!card) return null;

  const price = getDisplayPrice(card, foil);
  // Cardmarket's EUR figure ships in `card.prices.eur` (Scryfall sources
  // it directly from Cardmarket). Foil cards have their own `eur_foil`
  // value; fall back to non-foil when foil isn't separately listed.
  const eurRaw = foil
    ? card.prices?.eur_foil ?? card.prices?.eur
    : card.prices?.eur;
  const eur = eurRaw ? `€${Number(eurRaw).toFixed(2)}` : null;
  const mpUsd =
    mpPrice?.bestUsd != null ? `$${mpPrice.bestUsd.toFixed(2)}` : null;

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-end sm:items-center justify-center px-0 sm:px-4 py-0 sm:py-8 overflow-y-auto anim-detail-fade"
      data-modal-scroll
      role="dialog"
      aria-modal="true"
      aria-label={`${card.name} details`}
    >
      {/* Backdrop */}
      <button
        className="fixed inset-0 bg-black/70 backdrop-blur-md"
        onClick={onClose}
        aria-label="Close details"
      />

      {/* Sheet wrapper. Mobile: full-width, anchored to the bottom,
          rounded top corners only, internal scroll, slide-up
          animation, ≤92dvh tall, swipe-down dismissible. Desktop:
          keeps the original inline two-column layout. The grip
          handle at the top is the drag target for the swipe-down
          dismiss; pulling it down past 100px closes the modal. */}
      <div
        ref={sheetRef}
        className="relative w-full sm:max-w-3xl max-h-[92dvh] sm:max-h-none overflow-y-auto sm:overflow-visible anim-sheet-rise sm:anim-detail-rise px-4 pt-4 pb-6 sm:p-0 my-auto bg-[var(--color-bg)] sm:bg-transparent rounded-t-3xl sm:rounded-none border-t border-white/5 sm:border-0"
        data-modal-scroll
        style={swipe.sheetStyle}
        {...swipe.bind}
        // Tap-outside-content dismissal: any click on the sheet
        // wrapper itself (the padding / grip area / gaps between
        // content blocks) closes the modal. The card image and
        // info panel below each stop propagation so a tap on
        // actual content stays put. Mobile users hated the old
        // behavior where the only close path was the 8 % backdrop
        // strip at the top or a precise swipe on the grip.
        onClick={onClose}
      >
        {/* Bottom-sheet drag handle. Visual affordance for the swipe-
            down dismiss; the actual swipe is bound to the entire
            sheet wrapper above (with the iOS pull-to-dismiss
            idiom: only fires when the scroll container is at
            scrollTop=0). Hidden at sm+ where the modal floats in
            the viewport. */}
        <div
          aria-hidden
          className="sm:hidden flex justify-center -mt-1 mb-2 py-2 pointer-events-none"
        >
          <div className="w-12 h-1.5 rounded-full bg-white/25" />
        </div>
        <div className="grid md:grid-cols-[auto_1fr] gap-4 md:gap-10">
        {/* Card — shrinks on phones so the info panel still fits in view.
            stopPropagation only on the card itself (via an inner wrapper
            sized to the card width) so tapping in the empty area beside
            the centered card on phones still bubbles to the sheet and
            closes — only the card art and the info panel are "content". */}
        <div className="flex justify-center md:block">
          {/* w-fit shrinks this stop-propagation wrapper to exactly
              the card's width on mobile, so taps in the empty area
              beside the centered card still bubble to the sheet and
              dismiss. md:contents collapses the wrapper out of
              desktop layout — events still flow through it (and
              the stopPropagation still fires), but it no longer
              participates in the box model. */}
          <div
            onClick={(ev) => ev.stopPropagation()}
            className="w-fit md:contents"
          >
            <ResponsiveDetailCard card={card} foil={foil} />
          </div>
        </div>

        {/* Info — stop propagation so taps anywhere inside the panel
            (chips, text, buttons) don't bubble to the sheet's
            onClick={onClose}. Interactive elements inside still
            work normally; their own onClick fires before bubbling
            is stopped. */}
        <div
          onClick={(ev) => ev.stopPropagation()}
          className="liquid-panel rounded-2xl p-4 sm:p-6 md:p-7 flex flex-col gap-4 sm:gap-5 max-w-md self-center w-full"
        >
          <div>
            {/* Mobile-friendly headline size — text-xl (20px) on
                phones balances long card names like "Tamiyo,
                Inquisitive Student" without wrapping to 3 lines on
                a 320px-wide panel. `balance` evens the breaks. */}
            <h2 className="font-display text-xl sm:text-3xl md:text-4xl text-[var(--color-fg)] leading-tight balance">
              {card.name}
            </h2>
            {card.type_line && (
              <p className="text-sm text-[var(--color-ink)] mt-1">{card.type_line}</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <RarityChip rarity={card.rarity} />
            {foil && <span className="label-caps px-2.5 py-1 rounded-full bg-[var(--color-rarity-bonus)] text-white">Foil</span>}
            <span className="label-caps px-2.5 py-1 rounded-full liquid-glass text-[var(--color-fg)]">
              {card.set.toUpperCase()} · #{card.collector_number}
            </span>
          </div>

          {/* Artist credit. Honors the illustrator behind the art —
              Scryfall surfaces this on every card, and we already keep
              it on the trimmed client payload (see `trimCardForClient`
              in lib/scryfall.ts). Muted text so it sits as a quiet
              attribution rather than competing with the price block. */}
          {card.artist && (
            <p
              className="text-[12px] text-[var(--color-ink-muted)] -mt-1"
              style={{ fontFamily: "var(--font-ui)" }}
            >
              Art by{" "}
              <span className="text-[var(--color-fg)]/85">{card.artist}</span>
            </p>
          )}

          {price && (
            <div className="flex flex-col gap-1">
              <p className="label-caps text-[var(--color-ink-muted)]">
                Approx. Market price
              </p>
              {/* EUR / Cardmarket price now lives on the Cardmarket
                  button below — showing it here too would render the
                  same number twice. Keep this section as the headline
                  TCGplayer market reference. */}
              <p className="font-display text-3xl text-[var(--color-fg)]">{price.label}</p>
            </div>
          )}

          {/* Validate Scryfall's returned URI before rendering — defends
              against an upstream compromise injecting a `javascript:` URL
              or pointing at an unrelated host. Falls back to a disabled
              state if validation fails so we never paint a hostile href.
              Mana Pool's URL is deterministic from set + collector_number
              (their /card/<set>/<num> path 301s to the canonical slug),
              so it doesn't need the same Scryfall-supplied safeguarding —
              we still funnel it through safeExternalUrl for consistency. */}
          {(() => {
            const scryfallHref = safeExternalUrl(card.scryfall_uri);
            const mpHref = safeExternalUrl(getManaPoolCardUrl(card));
            const cmHref = safeExternalUrl(getCardmarketCardUrl(card.name));
            return (
              <div className="flex flex-wrap gap-2 mt-2">
                {mpHref && (
                  <a
                    href={mpHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-[var(--accent-purple)] text-white text-sm font-semibold hover:brightness-110 transition-all"
                  >
                    <ShoppingBag className="w-3.5 h-3.5" /> Buy on Mana Pool
                    {/* Live price pill — only renders once the hook
                        resolves AND Mana Pool has stock. While loading,
                        we don't show a placeholder to avoid layout
                        shift between the loading state and the result. */}
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
                    {/* Cardmarket's EUR price ships on the card from
                        Scryfall already (they're Scryfall's EUR source);
                        the inline pill shows it without a fetch. The
                        chip uses a translucent-dark fill so it reads
                        cleanly against the white button. */}
                    {eur && (
                      <span className="px-1.5 py-0.5 rounded-full bg-[var(--color-bg)]/10 text-[12px] font-semibold tabular-nums">
                        {eur}
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
            );
          })()}
        </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Render the modal's hero card at a width that fits the current viewport
 * minus the modal's outer padding. On phones (under 360px content space)
 * the card scales to ~240px so the info panel below has room to breathe;
 * tablets and above keep the 320px desktop default.
 */
function ResponsiveDetailCard({
  card, foil,
}: {
  card: import("@/lib/scryfall").ScryfallCard;
  foil?: boolean;
}) {
  const [w, setW] = useState(320);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const compute = () => {
      const avail = window.innerWidth - 32; // px-3 each side + buffer
      // Clamp between 220 and 320 — the smallest readable card width and
      // the design's max width on desktop.
      const next = Math.max(220, Math.min(320, avail));
      setW(next);
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);
  return (
    <MagicCard
      card={{ kind: "scryfall", card, foil }}
      faceUp
      width={w}
    />
  );
}

function RarityChip({ rarity }: { rarity: string }) {
  const colors: Record<string, string> = {
    common:   "var(--color-rarity-common)",
    uncommon: "var(--color-rarity-uncommon)",
    rare:     "var(--color-rarity-rare)",
    mythic:   "var(--color-rarity-mythic)",
    special:  "var(--color-rarity-bonus)",
    bonus:    "var(--color-rarity-bonus)",
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

// Tail-piece used to size and exit gracefully — even if image hasn't loaded.
export function getArtFallback(card: ScryfallCard): string | undefined {
  return getCardImage(card, "art_crop") ?? getCardImage(card, "normal");
}
