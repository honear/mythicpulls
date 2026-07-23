import { Swords } from "lucide-react";
import { getOpenableSets, getSetSampleArt, isComingSoonSet } from "@/lib/scryfall";
import { mapWithConcurrency } from "@/lib/concurrency";
import { getSetArtMap, type SetArtEntry } from "@/lib/set-art";
import { SetGrid } from "../_components/SetGrid";

/** See app/page.tsx for the static-map + concurrency-fallback rationale. */
const FALLBACK_CONCURRENCY = 4;

/**
 * Sealed format landing page. Mirrors the home set grid but each tile
 * routes to /sealed/<code> — the 6-pack-into-deckbuilder flow — instead
 * of the standard single-pack opener. The format constraints (6 Play
 * Boosters, 40-card minimum deck, any number of basic lands) are stated
 * in the page header so first-time players know what they're signing up
 * for before picking a set.
 */
export default async function SealedSetPickerPage() {
  // Coming-soon sets are omitted here entirely (vs. the /sets catalog's
  // teaser tiles) — no sealed pool exists before street date.
  const sets = (await getOpenableSets()).filter((s) => !isComingSoonSet(s));

  const sampleArt: Record<string, SetArtEntry> = { ...getSetArtMap() };
  const missing = sets.filter((s) => !sampleArt[s.code.toLowerCase()]);
  if (missing.length > 0) {
    const fetched = await mapWithConcurrency(
      missing,
      FALLBACK_CONCURRENCY,
      async (s) => {
        const art = await getSetSampleArt(s.code);
        return [s.code.toLowerCase(), art] as const;
      },
    );
    for (const [code, art] of fetched) {
      if (art) sampleArt[code] = { url: art, artist: null, cardName: null };
    }
  }

  return (
    <div className="flex flex-col">
      <section className="relative mx-auto max-w-7xl w-full px-4 sm:px-6 md:px-10 pt-24 sm:pt-28 pb-6">
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
        className="relative mx-auto max-w-7xl w-full px-4 sm:px-6 md:px-10 pb-16 sm:pb-24"
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
