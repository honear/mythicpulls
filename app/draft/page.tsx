import { Users } from "lucide-react";
import { getOpenableSets, getSetSampleArt } from "@/lib/scryfall";
import { SetGrid } from "../_components/SetGrid";

const SETS_WITH_ART = 48;

/**
 * Draft format landing page. Same shape as the sealed picker — tiles route
 * to /draft/<code> for the 8-seat 3-round flow. The format intro tells
 * first-time drafters what they're signing up for so the format-savvy can
 * jump in and the curious know the shape of the game before clicking.
 */
export default async function DraftSetPickerPage() {
  const sets = await getOpenableSets();

  const artLookups = await Promise.all(
    sets.slice(0, SETS_WITH_ART).map(async (s) => {
      const art = await getSetSampleArt(s.code);
      return [s.code.toLowerCase(), art] as const;
    }),
  );
  const sampleArt: Record<string, string> = {};
  for (const [code, art] of artLookups) {
    if (art) sampleArt[code] = art;
  }

  return (
    <div className="flex flex-col">
      <section className="relative mx-auto max-w-7xl w-full px-6 md:px-10 pt-28 pb-6">
        <div className="flex flex-col items-center text-center gap-3">
          <span className="hero-pill">
            <span className="hero-pill__badge">
              <Users className="w-3.5 h-3.5" />
            </span>
            Booster draft · 1v7 bots
          </span>
          <h1 className="hero-title balance" style={{ fontSize: "clamp(28px, 4vw, 44px)" }}>
            Take a seat. <em>Pick one card</em>, pass the rest.
          </h1>
          <p
            className="text-[15px] leading-snug max-w-[640px] text-white/70"
            style={{ fontFamily: "var(--font-ui)" }}
          >
            Three packs, eight seats, ~45 picks. You play with seven AI bots
            that signal colors and stay in their lanes. Build a 40-card deck
            from your picks plus as many basic lands as you want, then export.
          </p>
        </div>
      </section>

      <section
        className="relative mx-auto max-w-7xl w-full px-6 md:px-10 pb-24"
        id="sets"
      >
        <div className="flex items-end justify-between mb-4 gap-6 flex-wrap">
          <div>
            <p
              className="label-caps text-[var(--accent-purple-light)]"
              style={{ fontFamily: "var(--font-ui)" }}
            >
              Catalog · {sets.length} sets
            </p>
            <h2
              className="hero-title balance mt-1"
              style={{ fontSize: "clamp(22px, 2.8vw, 32px)" }}
            >
              Choose your draft set.
            </h2>
          </div>
        </div>
        <SetGrid
          sets={sets}
          sampleArt={sampleArt}
          linkBase="/draft"
          tileLabel="Draft"
        />
      </section>
    </div>
  );
}
