import { Layers, PackageOpen, Users } from "lucide-react";
import { getSetArtMap, type SetArtEntry } from "@/lib/set-art";
import { HomeHero } from "./_components/HomeHero";
import { ModeCard } from "./_components/ModeCard";

/**
 * Homepage. Three-CTA landing — the set catalog moved to `/sets` and
 * the homepage now leads with intent: pick a mode (open / draft /
 * sealed), then navigate into the per-mode flow.
 *
 * Featured art crops behind each ModeCard come from the static
 * `data/set-art.json` map; no live Scryfall calls. The three sets
 * are picked *randomly per request* — see the `dynamic = "force-
 * dynamic"` export below — so returning visitors get a different
 * palette each time without ever paying a network round-trip
 * (everything is already bundled at build time).
 */

// Opt out of static rendering on this route. The render itself is
// fast (no fetches, just JSX + bundled JSON), but we DO need Next to
// re-run it on every request so the three random art picks below
// actually vary. The trade-off is no CDN-cached HTML on /, which is
// fine for a low-traffic fan project — TTFB stays well under the
// notice threshold.
export const dynamic = "force-dynamic";

// Hand-picked sets used as the *fallback* when the random pool is
// somehow empty (shouldn't happen with 170+ cached entries). Kept
// here so a degenerate set-art.json doesn't crash the page.
const FALLBACK = { open: "blb", draft: "mh3", sealed: "dsk" } as const;

/** Pick `n` distinct random items from `arr` (small-n, large-arr
 *  friendly — uses a Set to dedupe indices on each draw). Returns
 *  the picks in random order. */
function pickN<T>(arr: T[], n: number): T[] {
  if (n >= arr.length) return arr.slice();
  const seen = new Set<number>();
  const out: T[] = [];
  while (out.length < n) {
    const i = Math.floor(Math.random() * arr.length);
    if (seen.has(i)) continue;
    seen.add(i);
    out.push(arr[i]);
  }
  return out;
}

export default function HomePage() {
  const artMap = getSetArtMap();
  const blank: SetArtEntry = { url: "", artist: null, cardName: null };
  // Pool of sets eligible for the random pick: must have an art URL
  // (skip the handful of pre-1996 sets without one) AND a known
  // artist (so the "Art by X" credit always renders — mixed-credit
  // cards reads inconsistent). 170+ entries qualify, plenty for
  // random selection without short-cycle repetition.
  const pool = Object.values(artMap).filter(
    (e) => !!e.url && !!e.artist,
  );
  const picks = pool.length >= 3
    ? pickN(pool, 3)
    : [
        artMap[FALLBACK.open] ?? blank,
        artMap[FALLBACK.draft] ?? blank,
        artMap[FALLBACK.sealed] ?? blank,
      ];
  const [openArt, draftArt, sealedArt] = picks;

  return (
    <div className="flex flex-col">
      <HomeHero />
      <section
        className="relative mx-auto max-w-7xl w-full px-4 sm:px-6 md:px-10 pb-20 sm:pb-28"
        id="modes"
      >
        {/* Always three-up at lg+ (1024px+); below that we collapse
            straight to a single column. We avoid the 2+1 in-between
            because that breaks the three-mode rhythm of the page —
            user explicitly preferred a stacked column to a lopsided
            grid. The 3-col threshold sits at lg rather than sm/md
            because each ModeCard packs an icon + eyebrow + title +
            two-line description + CTA pill + artist credit inside a
            63:88 aspect; below ~300px wide the CTA gets clipped.
            When stacked (single column), we cap the list at max-w-md
            so a tablet-sized viewport doesn't blow the cards up to
            ~1300px tall each. */}
        <ul className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5 md:gap-6 max-w-md mx-auto lg:max-w-none">
          <li className="anim-card-rise" style={{ animationDelay: "60ms" }}>
            <ModeCard
              icon={PackageOpen}
              eyebrow="Open packs · ~30 seconds"
              title="Open a pack."
              description={
                <>
                  Rip a virtual booster from any set.{" "}
                  <em className="text-[var(--color-fg)] not-italic font-medium">
                    Open packs for free
                  </em>
                  ; buy only the cards you actually want.
                </>
              }
              cta="Pick a set"
              href="/sets"
              artUrl={openArt.url}
              artist={openArt.artist}
            />
          </li>
          <li className="anim-card-rise" style={{ animationDelay: "140ms" }}>
            <ModeCard
              icon={Users}
              eyebrow="Practice · ~15 minutes"
              title="Run a draft."
              description={
                <>
                  Eight-seat booster draft against{" "}
                  <em className="text-[var(--color-fg)] not-italic font-medium">
                    17Lands-trained bots
                  </em>
                  . Pick, pass, build a 40-card deck.
                </>
              }
              cta="Start drafting"
              href="/draft"
              artUrl={draftArt.url}
              artist={draftArt.artist}
            />
          </li>
          <li className="anim-card-rise" style={{ animationDelay: "220ms" }}>
            <ModeCard
              icon={Layers}
              eyebrow="Practice · ~10 minutes"
              title="Build sealed."
              description={
                <>
                  Crack six packs, build a sealed deck. Export straight
                  to{" "}
                  <em className="text-[var(--color-fg)] not-italic font-medium">
                    Arena
                  </em>{" "}
                  when you're done.
                </>
              }
              cta="Start sealed"
              href="/sealed"
              artUrl={sealedArt.url}
              artist={sealedArt.artist}
            />
          </li>
        </ul>

        {/* Trust / detail strip — three small affordances under the
            CTAs that answer "what is this and what's free about it"
            for first-time visitors. */}
        <FeatureStrip />
      </section>
    </div>
  );
}

/**
 * Three small detail tiles that sit under the ModeCards. Pure marketing
 * copy — answers the "wait, what is this site?" question for a
 * first-time visitor without needing to scroll to the footer.
 */
function FeatureStrip() {
  return (
    <ul className="mt-10 sm:mt-14 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
      <FeatureTile
        title="175+ sets, every era"
        body="Every Magic set with a paper booster — Standard, Modern, Pioneer, Legacy."
      />
      <FeatureTile
        title="Live market prices"
        body="Mana Pool feeds pack prices in real time; Cardmarket prices on every card."
      />
      <FeatureTile
        title="Your binder, your browser"
        body="Pulls save locally. No account, no sync, no spend — your collection stays with you."
      />
    </ul>
  );
}

function FeatureTile({ title, body }: { title: string; body: string }) {
  return (
    <li className="rounded-2xl liquid-glass p-4 sm:p-5">
      <p
        className="label-caps text-[var(--accent-purple-light)] mb-1"
        style={{ fontFamily: "var(--font-ui)" }}
      >
        {title}
      </p>
      <p className="text-[14px] leading-snug text-white/70">{body}</p>
    </li>
  );
}
