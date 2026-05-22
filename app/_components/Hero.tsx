import { Sparkles } from "lucide-react";

/**
 * Compact, center-aligned hero. No background video — earlier we ran the
 * Datacore CloudFront loop here, but the still page reads cleaner against
 * the deep-purple ground and lets the set grid below carry the visual weight.
 *
 * The pill + headline + subtext live in a single centered column so the
 * eye lands on the headline first, then sweeps down to the grid.
 */
export function Hero() {
  return (
    <section
      data-screen-label="Hero"
      className="relative w-full"
      style={{ background: "var(--hero-bg)" }}
    >
      <div className="relative z-10 mx-auto max-w-7xl w-full px-6 md:px-10 pt-24 pb-8 md:pb-10">
        <div className="flex flex-col items-center text-center gap-3">
          <span className="hero-pill">
            <span className="hero-pill__badge">New</span>
            <Sparkles className="w-3.5 h-3.5 opacity-80" />
            Free booster simulator
          </span>
          <h1 className="hero-title balance">
            Rip Magic packs <em>and</em> keep every pull.
          </h1>
          <p
            className="text-[15px] leading-snug max-w-[460px] text-white/70"
            style={{ fontFamily: "var(--font-ui)" }}
          >
            No spend, no shuffle — just the rush of opening boosters from
            every Standard, Modern, and Legacy set.
          </p>
        </div>
      </div>
    </section>
  );
}
