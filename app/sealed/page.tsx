import { Swords } from "lucide-react";
import { getOpenableSets, getSetSampleArt } from "@/lib/scryfall";
import { SetGrid } from "../_components/SetGrid";

const SETS_WITH_ART = 48;

/**
 * Sealed format landing page. Mirrors the home set grid but each tile
 * routes to /sealed/<code> — the 6-pack-into-deckbuilder flow — instead
 * of the standard single-pack opener. The format constraints (6 Play
 * Boosters, 40-card minimum deck, any number of basic lands) are stated
 * in the page header so first-time players know what they're signing up
 * for before picking a set.
 */
export default async function SealedSetPickerPage() {
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
              <Swords className="w-3.5 h-3.5" />
            </span>
            Sealed deck format
          </span>
          <h1 className="hero-title balance" style={{ fontSize: "clamp(28px, 4vw, 44px)" }}>
            Pick a set. <em>Crack six packs.</em> Build a 40-card deck.
          </h1>
          <p
            className="text-[15px] leading-snug max-w-[560px] text-white/70"
            style={{ fontFamily: "var(--font-ui)" }}
          >
            Open six boosters of the set you choose, then build a sealed deck
            from the pool plus as many basic lands as you want. Export your
            list to import into MTGA, Untap, or any compatible client.
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
              Choose your sealed pool.
            </h2>
          </div>
        </div>
        <SetGrid
          sets={sets}
          sampleArt={sampleArt}
          linkBase="/sealed"
          tileLabel="Play"
        />
      </section>
    </div>
  );
}
