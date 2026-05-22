"use client";

import type { ScryfallCard } from "@/lib/scryfall";
import { getCardImage } from "@/lib/scryfall";

/** Renders the card art with proper fallbacks for double-faced layouts. */
export function CardArt({ card, size = "normal" }: { card: ScryfallCard; size?: "small" | "normal" | "large" }) {
  const src = getCardImage(card, size) ?? getCardImage(card, "normal");
  if (!src) {
    return (
      <div className="w-full h-full grid place-items-center bg-[var(--color-primary-50)] text-[var(--color-primary-700)] p-3 text-center">
        <div>
          <p className="font-display text-lg leading-tight">{card.name}</p>
          <p className="label-caps mt-1">{card.set.toUpperCase()} · {card.collector_number}</p>
        </div>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={card.name}
      loading="lazy"
      className="absolute inset-0 w-full h-full object-cover"
      draggable={false}
    />
  );
}
