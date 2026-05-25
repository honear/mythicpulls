/**
 * Homepage hero. The landing surface — pairs the brand mark with a
 * verbs-first headline that previews the three CTAs immediately below.
 *
 * Visual structure:
 *   1. Tree-of-life brand logo (the dropped `threetreecity_logo.svg`,
 *      recolored to the brand purple gradient — see the file in
 *      `public/threetreecity_logo.svg`. Wrapped here with a drop-
 *      shadow stack + a subtle radial halo behind it for the
 *      "glassy / relief" effect requested by the brief).
 *   2. Wordmark "Three Tree City".
 *   3. Headline naming all three verbs.
 *   4. Subhead crediting the data sources.
 *
 * No background image — the deep-purple ground + a soft radial glow do
 * the visual work, keeping the eye on the brand statement before it
 * sweeps down to the ModeCards. Adding hero art would compete with the
 * card-art backdrops on those cards.
 */

export function HomeHero() {
  return (
    <section
      data-screen-label="HomeHero"
      className="relative w-full overflow-hidden"
      style={{ background: "var(--hero-bg)" }}
    >
      {/* Soft radial glow behind the headline/wordmark area — gives
          the flat purple bg a sense of depth and ties the
          headline-and-subhead block together visually. The blur is
          wide so the gradient stays subtle; brightness drops off
          before it can compete with the text. The logo itself sits
          ABOVE the glow's center (logo is at the top of the content
          stack, glow centers around the headline), so this doesn't
          re-introduce the per-logo bloom we just removed. */}
      <div
        aria-hidden
        className="absolute pointer-events-none"
        style={{
          top: "10%",
          left: "50%",
          transform: "translate(-50%, 0)",
          width: "900px",
          height: "900px",
          maxWidth: "120vw",
          background:
            "radial-gradient(closest-side, rgba(164,132,215,0.18) 0%, rgba(164,132,215,0.06) 50%, rgba(164,132,215,0) 75%)",
          filter: "blur(12px)",
        }}
      />

      <div className="relative z-10 mx-auto max-w-5xl w-full px-4 sm:px-6 md:px-10 pt-20 sm:pt-24 md:pt-36 pb-6 sm:pb-10 md:pb-16">
        <div className="flex flex-col items-center text-center gap-5 sm:gap-6">
          <HeroLogo />
          <p
            className="label-caps text-[var(--accent-purple-light)]"
            style={{ fontFamily: "var(--font-ui)" }}
          >
            Three Tree City
          </p>
          <h1
            className="hero-title balance"
            style={{
              fontSize: "clamp(34px, 6.2vw, 70px)",
              lineHeight: 1.18,
              maxWidth: "880px",
            }}
          >
            {/* Three nouns in italic-purple ("packs", "drafts",
                "sealed"), the connective tissue in white. `<em>` picks
                up the existing `.hero-title em` rule, which already
                applies italic + purple + brand serif + a hair of
                horizontal padding so the italics don't crowd the
                neighboring punctuation. */}
            Open <em>packs</em>. Run <em>drafts</em>. Build <em>sealed</em> decks.
          </h1>
          <p
            className="text-[15px] sm:text-[17px] leading-snug max-w-[560px] text-white/70"
            style={{ fontFamily: "var(--font-ui)" }}
          >
            A free Magic: the Gathering booster, sealed, and draft
            simulator. Live prices from Mana Pool. Draft signals from
            17Lands.
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * Tree-of-life brand logo as the landing hero mark. The actual artwork
 * lives at `public/threetreecity_logo.svg` (recolored from the source
 * black-on-white drop to the brand purple gradient — see the comment at
 * the top of that file or the transform pipeline that produced it).
 *
 * Effect layering for the "glassy / relief" look:
 *   - Soft outer halo: a blurred radial gradient sized larger than the
 *     logo, pinned behind it. Gives the impression of light bleeding
 *     out from the mark.
 *   - Drop-shadow stack on the `<img>`: a wide purple glow (lift) + a
 *     tight dark shadow (anchor). Together they read as "the mark is
 *     floating slightly above the page surface".
 *   - Top sheen: a thin upward-pointing radial highlight overlaid on
 *     the top half of the logo via mix-blend-mode, suggesting a glassy
 *     surface catching light from above. Sized to the logo so it
 *     doesn't leak past the mark's silhouette.
 *
 * The logo is loaded as <img> (not inline) so the browser can cache it
 * across pages, and so SiteHeader can later reuse it without bloating
 * the bundle.
 */
function HeroLogo() {
  // Plain logo, no glow. Earlier iterations layered an outer halo,
  // a wide purple drop-shadow, and a top sheen — all removed per
  // design call. The gradient's own luminance against the deep-
  // purple page bg is enough on its own; the only filter kept is a
  // hairline dark shadow that lifts the silhouette by a couple of
  // pixels so the mark doesn't read as "stuck flat" on the bg.
  return (
    <div
      className="relative shrink-0"
      style={{
        width: "clamp(120px, 17vw, 170px)",
        aspectRatio: "1 / 1",
      }}
      aria-hidden
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/threetreecity_logo.svg?v=tree-grad"
        alt="Three Tree City"
        className="relative w-full h-full"
        style={{
          filter: "drop-shadow(0 2px 4px rgba(0, 0, 0, 0.35))",
        }}
        draggable={false}
      />
    </div>
  );
}
