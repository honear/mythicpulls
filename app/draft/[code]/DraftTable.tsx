"use client";

import { ArrowDown, ArrowUp, User } from "lucide-react";

/**
 * Top-of-page indicator showing the 8 seats and which way packs are
 * passing this round. Compact — fits in a single horizontal strip above
 * the pick panel. Highlights the user's seat (always index 0) and shows
 * how many cards each bot has picked so far.
 */
export interface SeatInfo {
  name: string;
  isBot: boolean;
  poolSize: number;
}

export function DraftTable({
  seats, passDirection, round, totalRounds,
}: {
  seats: SeatInfo[];
  passDirection: "left" | "right";
  round: number;
  totalRounds: number;
}) {
  return (
    <div className="rounded-2xl liquid-glass px-5 py-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <p
          className="text-[14px] font-semibold tracking-wide text-[var(--color-fg)]"
          style={{ fontFamily: "var(--font-ui)" }}
        >
          Pack {round}{" "}
          <span className="text-[var(--color-ink-muted)]">of {totalRounds}</span>
        </p>
        <DirectionBadge dir={passDirection} />
      </div>
      <div className="flex items-center gap-1.5 overflow-x-auto">
        {seats.map((seat, i) => (
          <SeatChip key={i} seat={seat} isYou={i === 0} />
        ))}
      </div>
    </div>
  );
}

function DirectionBadge({ dir }: { dir: "left" | "right" }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium tracking-wide border border-[var(--color-line)]"
      style={{
        color: "var(--color-ink)",
        fontFamily: "var(--font-ui)",
      }}
      title={`Packs are being passed to the ${dir}`}
    >
      {dir === "left" ? (
        <ArrowUp className="w-3 h-3" style={{ transform: "rotate(-90deg)" }} />
      ) : (
        <ArrowDown className="w-3 h-3" style={{ transform: "rotate(-90deg)" }} />
      )}
      Passing {dir}
    </span>
  );
}

function SeatChip({ seat, isYou }: { seat: SeatInfo; isYou: boolean }) {
  return (
    <div
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] tabular-nums shrink-0"
      style={{
        background: isYou ? "var(--accent-purple)" : "rgba(255,255,255,0.06)",
        color: isYou ? "white" : "var(--color-ink)",
        fontFamily: "var(--font-ui)",
        fontWeight: isYou ? 600 : 400,
        border: isYou ? "none" : "1px solid var(--color-line)",
      }}
    >
      {isYou ? <User className="w-3 h-3" /> : null}
      <span>{seat.name}</span>
      <span style={{ opacity: 0.7 }}>{seat.poolSize}</span>
    </div>
  );
}
