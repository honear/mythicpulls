"use client";

import { useEffect, useState } from "react";
import type { ScryfallCard, ScryfallImageUris } from "@/lib/scryfall";
import { getCardImage } from "@/lib/scryfall";
import { useCardTilt } from "@/lib/useCardTilt";

/** Card back URL. Kept on the PNG variant: it's a single asset served
 *  once and cached by the browser for the rest of the session, so the
 *  per-card payload cost is paid once across the whole app — not worth
 *  the risk of guessing at a JPEG path that may not exist on
 *  backs.scryfall.io. The rounded corners are applied via CSS at the
 *  face level (overflow:hidden + border-radius) so transparency in the
 *  PNG doesn't add any visual information here either. */
export const CARD_BACK_URL =
  "https://backs.scryfall.io/png/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.png";

/**
 * Pick the smallest Scryfall image variant that still renders crisply
 * at the given on-screen width. Scryfall variants:
 *   • normal — 488 × 680, ~60–90 KB
 *   • large  — 672 × 936, ~110–160 KB
 * The rounded corner is applied by CSS on `.card-mtg__face`, so JPEG
 * sources clip exactly like the legacy PNG did — without the 500 KB–
 * 1 MB PNG payload per card. Threshold at 175 px keeps mobile cards
 * on `normal` (so a 15-card pack rip drops from ~10 MB to ~1 MB on
 * phones) while desktop renders ≥176 px get the sharper `large`.
 */
function preferredImageSize(width?: number): keyof ScryfallImageUris {
  return width && width <= 175 ? "normal" : "large";
}

export type CardLike =
  | { kind: "scryfall"; card: ScryfallCard; foil?: boolean }
  | {
      kind: "lite";
      name: string;
      typeLine?: string;
      art: string;
      setCode: string;
      collectorNumber?: string;
      rarity?: "common" | "uncommon" | "rare" | "mythic" | "special" | "bonus";
      foil?: boolean;
    };

interface Props {
  card: CardLike;
  faceUp?: boolean;
  onClick?: () => void;
  width?: number;
  className?: string;
  /** Disable the holo shimmer entirely (useful when the card is in a deck). */
  holoEnabled?: boolean;
}

export function MagicCard({
  card,
  faceUp = true,
  onClick,
  width,
  className,
  holoEnabled = true,
}: Props) {
  const data = normalize(card, width);

  // Track JPEG-loaded state per face so a card-shaped skeleton can show
  // while the image is in flight. Without this, slow / cold-cache
  // images paint as a blank rectangle (or worse, a broken image icon).
  // Skeleton fades out via `is-loaded` on the face wrapper; see
  // `.card-mtg__skeleton` in globals.css.
  const [frontLoaded, setFrontLoaded] = useState(false);
  const [backLoaded, setBackLoaded] = useState(false);
  // Reset loaded state if the underlying front URL changes (binder
  // re-sort, switching pulls, etc.) so the skeleton appears for the
  // new card while its JPEG fetches.
  useEffect(() => {
    setFrontLoaded(false);
  }, [data.front]);
  // Holo shimmer is reserved for traditional foils — i.e. cards that came
  // out of a slot flagged `foil: true` in pack-rules.ts. Earlier this also
  // fired on every rare/mythic regardless of foil state, which made Play
  // boosters look foil-heavy (every guaranteed rare/mythic shimmered) and
  // Collector boosters look comparatively flat by contrast. Tying the
  // overlay strictly to `data.foil` aligns the visual with real Magic:
  // traditional foils shimmer, non-foils don't, regardless of rarity.
  const isHolographic = holoEnabled && faceUp && !!data.foil;

  // Tilt is always active for parallax — but holographic shimmer is gated
  // on faceUp so a face-down card never reveals itself via the holo overlay.
  const tilt = useCardTilt({ holographic: isHolographic });

  // When `width` is set, push it into --card-base so the proportional
  // radius (--card-radius = 2.5/63 of width) recomputes at every size.
  // We also write --card-art-url whenever the front face is showing —
  // the "masked" holo style uses it as a CSS mask source.
  const styleVars: Record<string, string | number> = {};
  if (width) {
    styleVars.width = width;
    styleVars["--card-base"] = `${width}px`;
  }
  if (faceUp && data.front) {
    styleVars["--card-art-url"] = `url("${data.front}")`;
  }
  const sizeStyle =
    Object.keys(styleVars).length > 0
      ? (styleVars as React.CSSProperties)
      : undefined;

  return (
    <div
      className={`card-mtg ${className ?? ""}`}
      style={sizeStyle}
      ref={tilt.ref}
      onPointerEnter={tilt.onPointerEnter}
      onPointerMove={tilt.onPointerMove}
      onPointerLeave={tilt.onPointerLeave}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      aria-label={faceUp ? data.name : "Magic card, face down"}
    >
      <div className={`card-flip ${faceUp ? "" : "is-flipped"}`}>
        <div className={`card-mtg__face ${frontLoaded ? "is-loaded" : ""}`}>
          {/* Loading skeleton — purple card-shaped shimmer that sits
              under the JPEG until it loads, then fades out via the
              `is-loaded` class. Skipped entirely when there's no
              front URL (rare edge case) since there's nothing to wait
              on; the empty face is what the user has anyway. */}
          {data.front && <span className="card-mtg__skeleton" aria-hidden />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.front}
            alt={data.name}
            className="card-mtg__art"
            draggable={false}
            loading="lazy"
            onLoad={() => setFrontLoaded(true)}
            // `error` resolves the same — we never want a missing image
            // to leave the skeleton spinning forever. The <img> still
            // renders alt text via the empty src.
            onError={() => setFrontLoaded(true)}
          />
          {/* Glare + holo only on the front face, and only when revealed.
              The holo's visual treatment (default shimmer, masked, or
              off) is selected by the global <HoloToggle> which writes
              body[data-holo] — see globals.css. */}
          {faceUp && <span className="card-mtg__glare" />}
          {isHolographic && <span className="card-mtg__holo" />}
        </div>
        <div className={`card-mtg__face card-mtg__face--back ${backLoaded ? "is-loaded" : ""}`}>
          {/* Back face uses the same card-back JPEG for every card so
              the skeleton only flashes on the very first card render
              per session; subsequent renders hit the HTTP cache and
              `onLoad` fires synchronously enough that the skeleton
              never even paints. Still included for completeness. */}
          <span className="card-mtg__skeleton" aria-hidden />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={CARD_BACK_URL}
            alt=""
            className="card-mtg__art"
            draggable={false}
            loading="lazy"
            onLoad={() => setBackLoaded(true)}
            onError={() => setBackLoaded(true)}
          />
          {/* Glare on the back too — parallax still feels alive while face-down. */}
          {!faceUp && <span className="card-mtg__glare" />}
        </div>
      </div>
    </div>
  );
}

function normalize(card: CardLike, width?: number): {
  name: string;
  front: string;
  setCode: string;
  collectorNumber?: string;
  rarity?: string;
  foil?: boolean;
} {
  // Pick the smallest Scryfall variant that still looks crisp at the
  // requested render width; fall back to the other variant if Scryfall
  // didn't provide the preferred one (rare).
  const preferred = preferredImageSize(width);
  const fallback: keyof ScryfallImageUris = preferred === "large" ? "normal" : "large";
  if (card.kind === "scryfall") {
    const c = card.card;
    const front =
      getCardImage(c, preferred) ??
      getCardImage(c, fallback) ??
      c.card_faces?.[0]?.image_uris?.[preferred] ??
      c.card_faces?.[0]?.image_uris?.[fallback] ??
      "";
    return {
      name: c.name,
      front,
      setCode: c.set,
      collectorNumber: c.collector_number,
      rarity: c.rarity,
      foil: card.foil,
    };
  }
  return {
    name: card.name,
    front: toFullCard(card.art, preferred),
    setCode: card.setCode,
    collectorNumber: card.collectorNumber,
    rarity: card.rarity,
    foil: card.foil,
  };
}

/**
 * Rewrite a saved Scryfall image URL to a chosen JPEG variant. Binder
 * entries store whatever URL the card had at pull time (typically the
 * `art_crop` or `normal` URL) — this swaps the size segment so the
 * binder renders the full card art at a sensible resolution. The CSS
 * radius on `.card-mtg__face` handles the rounded corners, so any of
 * Scryfall's JPEG variants works.
 */
function toFullCard(url: string, size: keyof ScryfallImageUris): string {
  if (!url) return url;
  // Switch the size segment, and unwind any `.png` extension a previous
  // build may have written to the binder (legacy entries pointed at the
  // PNG variant).
  return url
    .replace(/\/(art_crop|small|normal|large|png|border_crop)\//, `/${size}/`)
    .replace(/\.png(\?|$)/, ".jpg$1");
}

export function MagicCardBack({ width }: { width?: number }) {
  const tilt = useCardTilt();
  const sizeStyle = width
    ? ({ width, ["--card-base" as string]: `${width}px` } as React.CSSProperties)
    : undefined;
  return (
    <div
      className="card-mtg"
      style={sizeStyle}
      ref={tilt.ref}
      onPointerEnter={tilt.onPointerEnter}
      onPointerMove={tilt.onPointerMove}
      onPointerLeave={tilt.onPointerLeave}
    >
      <div className="card-mtg__face">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CARD_BACK_URL} alt="" className="card-mtg__art" draggable={false} />
        <span className="card-mtg__glare" />
      </div>
    </div>
  );
}

export function MagicCardFlippable({
  card, initialFaceUp = false, onFlip, width,
}: {
  card: CardLike;
  initialFaceUp?: boolean;
  onFlip?: (faceUp: boolean) => void;
  width?: number;
}) {
  const [faceUp, setFaceUp] = useState(initialFaceUp);
  return (
    <MagicCard
      card={card}
      faceUp={faceUp}
      width={width}
      onClick={() => {
        const next = !faceUp;
        setFaceUp(next);
        onFlip?.(next);
      }}
    />
  );
}

export function toArtCrop(url: string | undefined): string | undefined {
  if (!url) return url;
  return url.replace(
    /\/(small|normal|large|png|border_crop)\//,
    "/art_crop/",
  );
}
