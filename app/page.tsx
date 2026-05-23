import { getOpenableSets, getSetSampleArt } from "@/lib/scryfall";
import { mapWithConcurrency } from "@/lib/concurrency";
import { getSetArtMap } from "@/lib/set-art";
import { SetGrid } from "./_components/SetGrid";
import { Hero } from "./_components/Hero";

// Cache lifetime is configured at the fetch layer in lib/scryfall.ts via
// `next: { revalidate }`. A page-level `revalidate` export combined with
// async data fetches is rejected by Next.js 16 as an invalid segment config.

/** Concurrency cap on the live-fallback art fetches. The static map in
 *  data/set-art.json covers the catalog at SSR time with zero live
 *  Scryfall calls; only sets added after the last `node scripts/build-set-art.mjs`
 *  run go through this fallback. Concurrency=4 stays well under
 *  Scryfall's 10 req/sec ceiling while keeping the fallback path quick. */
const FALLBACK_CONCURRENCY = 4;

export default async function HomePage() {
  const sets = await getOpenableSets();

  // Step 1 — pull every set's art from the bundled static map.
  // Instant; no network.
  const sampleArt: Record<string, string> = { ...getSetArtMap() };

  // Step 2 — for any set not in the static map (a new release between
  // script runs), fetch live with a small concurrency budget. Sets
  // already in the map skip this entirely.
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
      if (art) sampleArt[code] = art;
    }
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
