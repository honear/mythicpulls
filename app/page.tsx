import Link from "next/link";
import { getOpenableSets } from "@/lib/scryfall";
import { SetGrid } from "./_components/SetGrid";
import { Hero } from "./_components/Hero";

// Cache lifetime is configured at the fetch layer in lib/scryfall.ts via
// `next: { revalidate }`. A page-level `revalidate` export combined with
// async data fetches is rejected by Next.js 16 as an invalid segment config.

export default async function HomePage() {
  const sets = await getOpenableSets();

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
        <SetGrid sets={sets} />
      </section>
    </div>
  );
}
