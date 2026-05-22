"use client";

import { useState } from "react";
import type { ScryfallCard } from "@/lib/scryfall";
import { getCardImage } from "@/lib/scryfall";
import { useCardTilt } from "@/lib/useCardTilt";

/** Scryfall's PNG back has transparent corners so the card's natural
 *  rounded corners show through against any background. */
export const CARD_BACK_URL =
  "https://backs.scryfall.io/png/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.png";

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
  const data = normalize(card);
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
  const sizeStyle = width
    ? ({ width, ["--card-base" as string]: `${width}px` } as React.CSSProperties)
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
        <div className="card-mtg__face">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.front}
            alt={data.name}
            className="card-mtg__art"
            draggable={false}
            loading="lazy"
          />
          {/* Glare + holo only on the front face, and only when revealed. */}
          {faceUp && <span className="card-mtg__glare" />}
          {isHolographic && <span className="card-mtg__holo" />}
        </div>
        <div className="card-mtg__face card-mtg__face--back">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={CARD_BACK_URL}
            alt=""
            className="card-mtg__art"
            draggable={false}
            loading="lazy"
          />
          {/* Glare on the back too — parallax still feels alive while face-down. */}
          {!faceUp && <span className="card-mtg__glare" />}
        </div>
      </div>
    </div>
  );
}

function normalize(card: CardLike): {
  name: string;
  front: string;
  setCode: string;
  collectorNumber?: string;
  rarity?: string;
  foil?: boolean;
} {
  if (card.kind === "scryfall") {
    const c = card.card;
    // Prefer PNG so transparent corners reveal the card's natural radius.
    const front =
      getCardImage(c, "png") ??
      getCardImage(c, "large") ??
      getCardImage(c, "normal") ??
      c.card_faces?.[0]?.image_uris?.png ??
      c.card_faces?.[0]?.image_uris?.large ??
      c.card_faces?.[0]?.image_uris?.normal ??
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
    front: toFullCard(card.art),
    setCode: card.setCode,
    collectorNumber: card.collectorNumber,
    rarity: card.rarity,
    foil: card.foil,
  };
}

/** Rewrite Scryfall image URLs to the PNG variant (transparent corners). */
function toFullCard(url: string): string {
  if (!url) return url;
  // Switch the size segment to /png/ AND the extension to .png if present.
  return url
    .replace(/\/(art_crop|small|normal|large|border_crop)\//, "/png/")
    .replace(/\.jpg(\?|$)/, ".png$1");
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
