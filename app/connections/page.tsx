import type { Metadata } from "next";
import { Grid3x3 } from "lucide-react";
import { getDailyPuzzle, todayUtcDate } from "@/lib/connections";
import { ConnectionsGame } from "./ConnectionsGame";

/**
 * Confluence — the daily MTG connections puzzle. Sixteen card names,
 * four hidden groups of four, one solution.
 *
 * Server component resolves *today's* board (UTC) from the static pool
 * and hands exactly one puzzle to the client — the full pool (with
 * every answer) stays server-side; see lib/connections.ts.
 */

// The board flips at UTC midnight, so the page must re-render per
// request rather than freeze the build-time date into static HTML.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // Layout template appends "· Three Tree City" — don't repeat it here.
  title: "Confluence — Daily Magic Puzzle",
  description:
    "A free daily Magic: The Gathering puzzle. Sixteen card names, four hidden groups of four — find the connections without four mistakes.",
};

export default function ConnectionsPage() {
  const dateUtc = todayUtcDate();
  const { puzzle, number } = getDailyPuzzle(dateUtc);

  return (
    <div className="flex flex-col">
      <section className="relative mx-auto max-w-7xl w-full px-4 sm:px-6 md:px-10 pt-24 sm:pt-28 pb-6">
        <div className="flex flex-col items-center text-center gap-3">
          <span className="hero-pill">
            <span className="hero-pill__badge">
              <Grid3x3 className="w-3.5 h-3.5" />
            </span>
            Daily puzzle · Confluence #{number}
          </span>
          <h1
            className="hero-title balance"
            style={{ fontSize: "clamp(28px, 4vw, 44px)" }}
          >
            Four groups of four. <em>Find the connections.</em>
          </h1>
          <p
            className="text-[15px] leading-snug max-w-[640px] text-white/70"
            style={{ fontFamily: "var(--font-ui)" }}
          >
            Sixteen Magic cards share four hidden threads — a creature type, an
            artist, a printed cycle, a word in the name. Group them all before
            your fourth mistake. New board every day at midnight UTC.
          </p>
        </div>
      </section>

      <section className="relative mx-auto w-full max-w-3xl px-4 sm:px-6 pb-20 sm:pb-28">
        <ConnectionsGame
          initialPuzzle={puzzle}
          puzzleNumber={number}
          dateUtc={dateUtc}
        />
      </section>
    </div>
  );
}
