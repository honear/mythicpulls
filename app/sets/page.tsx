import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getOpenableSets, getSetSampleArt } from "@/lib/scryfall";
import { mapWithConcurrency } from "@/lib/concurrency";
import { getSetArtMap, type SetArtEntry } from "@/lib/set-art";
import { SetGrid } from "../_components/SetGrid";

/**
 * Set picker for the "Open a pack" flow. Moved out of the homepage
 * during the redesign — the homepage now leads with the three-CTA
 * landing, and users who pick "Open a pack" land here to choose which
 * set to crack.
 *
 * The data-loading pattern matches `/sealed/page.tsx` and
 * `/draft/page.tsx`: static set-art map from `data/set-art.json` as the
 * primary source, with a small concurrency-budgeted live Scryfall
 * fallback for any set added after the last `build-set-art.mjs` run.
 */

const FALLBACK_CONCURRENCY = 4;

export const metadata = {
  title: "Open a pack — pick a set",
  description:
    "Crack a virtual booster from any Standard, Modern, or Legacy-legal Magic set. Free, in your browser.",
};

export default async function SetsPage() {
  const sets = await getOpenableSets();

  // Step 1 — bundled static map. Zero network. Each entry includes
  // the art URL plus artist + cardName credit (see lib/set-art.ts).
  const sampleArt: Record<string, SetArtEntry> = { ...getSetArtMap() };

  // Step 2 — live fallback only for sets the static map missed (new
  // releases between script runs). The fallback only fills the URL —
  // we accept that brand-new sets won't carry artist credit until the
  // next `node scripts/build-set-art.mjs` run.
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
    <div className="mx-auto max-w-7xl w-full px-4 sm:px-6 md:px-10 pt-24 sm:pt-28 md:pt-32 pb-16 sm:pb-24">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 label-caps text-[var(--color-ink-muted)] hover:text-[var(--color-fg)] transition-colors mb-3"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
        Back to home
      </Link>
      <header className="mb-8 sm:mb-10">
        <p
          className="label-caps text-[var(--accent-purple-light)]"
          style={{ fontFamily: "var(--font-ui)" }}
        >
          Catalog · {sets.length} sets
        </p>
        <h1 className="font-display text-[1.9rem] sm:text-[2.2rem] md:text-6xl text-[var(--color-fg)] mt-2 leading-[0.95] balance">
          Pick a set. <em className="ai-grad">Rip it</em> open.
        </h1>
        <p className="mt-3 text-[var(--color-ink)] max-w-xl">
          Every set with a paper booster — Play, Draft, and Collector
          variants where applicable. Open as many packs as you like;
          buy only the cards you actually want.
        </p>
      </header>
      <SetGrid sets={sets} sampleArt={sampleArt} />
    </div>
  );
}
