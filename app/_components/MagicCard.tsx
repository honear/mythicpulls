"use client";

import { useState } from "react";
import type { ScryfallCard } from "@/lib/scryfall";
import { getCardImage } from "@/lib/scryfall";
import { useCardTilt } from "@/lib/useCardTilt";

/** Default Magic card back, hosted by Scryfall. */
export const CARD_BACK_URL =
  "https://backs.scryfall.io/large/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg";

export type CardLike =
  | { kind: "scryfall"; card: ScryfallCard; foil?: boolean }
  | {
      kind: "lite";
      name: string;
      typeLine?: string;
      /** Image URL — any Scryfall size. Will be normalized to /normal/. */
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
  /** Override the card width in px. Falls back to --card-base from CSS. */
  width?: number;
  className?: string;
}

export function MagicCard({ card, faceUp = true, onClick, width, className }: Props) {
  const data = normalize(card);
  const isHolographic =
    !!data.foil || data.rarity === "mythic" || data.rarity === "rare";
  const tilt = useCardTilt({ holographic: isHolographic });

  return (
    <div
      className={`card-mtg ${className ?? ""}`}
      style={width ? { width } : undefined}
      ref={tilt.ref}
      onPointerEnter={tilt.onPointerEnter}
      onPointerMove={tilt.onPointerMove}
      onPointerLeave={tilt.onPointerLeave}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      aria-label={faceUp ? data.name : "Magic card, face down"}
    >
      <div className={`card-flip ${faceUp ? "" : "is-flipped"}`}>
        {/* Front — full card image (frame, oracle text, P/T, etc.) */}
        <div className="card-mtg__face">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.front}
            alt={data.name}
            className="card-mtg__art"
            draggable={false}
            loading="lazy"
          />
          <span className="card-mtg__glare" />
          {isHolographic && <span className="card-mtg__holo" />}
        </div>
        {/* Back — real Magic card back */}
        <div className="card-mtg__face card-mtg__face--back">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={CARD_BACK_URL}
            alt=""
            className="card-mtg__art"
            draggable={false}
            loading="lazy"
          />
          <span className="card-mtg__glare" />
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
    const front =
      getCardImage(c, "large") ??
      getCardImage(c, "normal") ??
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

/** Rewrite Scryfall image URLs to the /normal/ full-card size so older
 *  art_crop saves render with frame, text box, and P/T like real cards. */
function toFullCard(url: string): string {
  if (!url) return url;
  return url.replace(
    /\/(art_crop|small|large|png|border_crop)\//,
    "/normal/",
  );
}

/** Quick face-down standalone card. */
export function MagicCardBack({ width }: { width?: number }) {
  const tilt = useCardTilt();
  return (
    <div
      className="card-mtg"
      style={width ? { width } : undefined}
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

/**
 * Helper for using art-crop URLs elsewhere (backgrounds, hero accents).
 * Accepts any Scryfall image URL or a card and returns the art_crop variant.
 */
export function toArtCrop(url: string | undefined): string | undefined {
  if (!url) return url;
  return url.replace(
    /\/(small|normal|large|png|border_crop)\//,
    "/art_crop/",
  );
}
