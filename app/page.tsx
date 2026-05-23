import { getOpenableSets, getSetSampleArt } from "@/lib/scryfall";
import { SetGrid } from "./_components/SetGrid";
import { Hero } from "./_components/Hero";

// Cache lifetime is configured at the fetch layer in lib/scryfall.ts via
// `next: { revalidate }`. A page-level `revalidate` export combined with
// async data fetches is rejected by Next.js 16 as an invalid segment config.

/** How many recent sets get a per-set art-crop background tile. Bumped to
 *  48 because the new layout shows the grid above the fold — we want the
 *  full first-page worth of tiles to land with their own art, not just the
 *  top 24. Each call is cached for 7 days, so subsequent loads hit cache. */
const SETS_WITH_ART = 48;

export default async function HomePage() {
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
      <Hero />
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
              style={{ fontSize: "clamp(26px, 3.2vw, 36px)" }}
            >
              Pick a set. <em>Rip it</em> open.
            </h2>
          </div>
        </div>
        <SetGrid sets={sets} sampleArt={sampleArt} />
      </section>
    </div>
  );
}
