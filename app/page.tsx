import Link from "next/link";
import { getOpenableSets, getSetSampleArt } from "@/lib/scryfall";
import { SetGrid } from "./_components/SetGrid";
import { Hero } from "./_components/Hero";

// Cache lifetime is configured at the fetch layer in lib/scryfall.ts via
// `next: { revalidate }`. A page-level `revalidate` export combined with
// async data fetches is rejected by Next.js 16 as an invalid segment config.

/** How many recent sets get a per-set art-crop background tile. Keeps the
 *  initial Scryfall fan-out reasonable; older sets fall back to icon-only. */
const SETS_WITH_ART = 24;

export default async function HomePage() {
  const sets = await getOpenableSets();

  // Fan out one Scryfall request per set for the first N sets, in parallel.
  // Each call is cached for 7 days, so subsequent builds + users hit cache.
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
        className="relative mx-auto max-w-7xl w-full px-6 pb-24 pt-16"
        id="sets"
      >
        <div className="flex items-end justify-between mb-8 gap-6 flex-wrap">
          <div>
            <p className="label-caps text-[var(--color-ink-muted)]">
              Catalog · {sets.length} sets
            </p>
            <h2 className="font-display text-3xl md:text-5xl text-[var(--color-fg)] mt-2 balance leading-[0.95]">
              Choose a set.
              <span className="ai-grad"> Rip it open.</span>
            </h2>
          </div>
          <Link
            href="/collection"
            className="btn-hero-secondary liquid-glass label-caps px-5 py-3 rounded-full"
          >
            My binder
          </Link>
        </div>
        <SetGrid sets={sets} sampleArt={sampleArt} />
      </section>
    </div>
  );
}
