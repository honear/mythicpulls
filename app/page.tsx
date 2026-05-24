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
 * `data/set-art.json` map; no live Scryfall calls. Three hand-picked
 * sets serve as the visual hooks — easy to swap by changing the
 * codes below.
 */

// Hand-picked sets used as the atmospheric backdrop for each ModeCard.
// The art is heavily darkened by ModeCard's gradient overlay so the
// exact choice matters less than "is this art in the static map?";
// these three are all in the bundled set-art.json. Swap freely.
const FEATURED_ART = {
  /** Bloomburrow — bright, inviting cottagecore palette. */
  open: "blb",
  /** Modern Horizons 3 — saturated, competitive energy. */
  draft: "mh3",
  /** Duskmourn — moody, contemplative for the deck-builder. */
  sealed: "dsk",
} as const;

export default function HomePage() {
  const artMap = getSetArtMap();
  // Resolve once so we can hand each ModeCard the full entry
  // (url + artist + cardName) — null-safe via fallback empty entry
  // so a missing featured set just hides the credit instead of
  // crashing render.
  const blank: SetArtEntry = { url: "", artist: null, cardName: null };
  const openArt = artMap[FEATURED_ART.open] ?? blank;
  const draftArt = artMap[FEATURED_ART.draft] ?? blank;
  const sealedArt = artMap[FEATURED_ART.sealed] ?? blank;

  return (
    <div className="flex flex-col">
      <HomeHero />
      <section
        className="relative mx-auto max-w-7xl w-full px-4 sm:px-6 md:px-10 pb-20 sm:pb-28"
        id="modes"
      >
        {/* Three-up on desktop, stacks on mobile. Gap roughly matches
            the page gutter so the cards breathe but stay grouped as
            a single composition. */}
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 md:gap-6">
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
