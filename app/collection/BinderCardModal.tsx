"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, ShoppingBag, X } from "lucide-react";
import type { CollectionEntry } from "@/lib/collection";
import { safeExternalUrl } from "@/lib/safe-url";
import { getManaPoolCardUrl } from "@/lib/manapool";
import { useManaPoolSingle } from "@/lib/useManaPoolSingle";
import { getCardmarketCardUrl } from "@/lib/cardmarket";
import { useScryfallCardPrice } from "@/lib/useScryfallCardPrice";
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
  // Mobile suppression matches CardDetailModal — the full-bleed overlay
  // doesn't fit on phones yet. Reconsider when we redesign a mobile
  // card details surface.
  const [suppress, setSuppress] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 639px)");
    const on = () => setSuppress(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    if (entry && suppress) onClose();
  }, [entry, suppress, onClose]);

  // Escape to close.
  useEffect(() => {
    if (!entry || suppress) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entry, onClose, suppress]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!entry || suppress) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [entry, suppress]);

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

  if (!entry || suppress || !mounted) return null;

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
      className="fixed inset-0 z-[1200] flex items-start sm:items-center justify-center px-3 sm:px-4 py-4 sm:py-8 overflow-y-auto anim-detail-fade"
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

      <div className="relative grid md:grid-cols-[auto_1fr] gap-4 md:gap-10 max-w-3xl w-full anim-detail-rise my-auto">
        {/* Card image — uses the kind="lite" path so we don't need a
            full ScryfallCard. Width tracks the existing CardDetailModal
            responsive sizing. */}
        <div className="flex justify-center md:block">
          <BinderDetailCard entry={entry} />
        </div>

        {/* Info panel */}
        <div className="liquid-panel rounded-2xl p-4 sm:p-6 md:p-7 flex flex-col gap-4 sm:gap-5 max-w-md self-center w-full">
          <div>
            <h2 className="font-display text-2xl sm:text-3xl md:text-4xl text-[var(--color-fg)] leading-tight">
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
