import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Legal & disclosures — Mythic Grounds",
  description:
    "Terms of use, trademark acknowledgments, and the nature of Mythic Grounds as an unofficial fan project.",
};

/**
 * Legal landing page — links from the global footer. Long-form prose
 * intentionally; this is the place to be explicit about what this site
 * is, what it isn't, and whose intellectual property we're playing with.
 *
 * Sections are kept fairly self-contained so individual entries can be
 * lifted into other contexts (e.g. an "about" page) without rewiring.
 */
export default function LegalPage() {
  return (
    <section className="mx-auto max-w-3xl w-full px-4 sm:px-6 pt-24 sm:pt-28 pb-14 md:pb-20">
      <header className="mb-10">
        <p className="label-caps text-[var(--color-ink-muted)] mb-3">
          Disclosures · last updated 2026-05
        </p>
        <h1
          className="font-display text-4xl md:text-5xl text-[var(--color-fg)] leading-tight"
        >
          Legal &amp; the nature of Mythic Grounds
        </h1>
        <p className="mt-4 text-[var(--color-ink)] text-[15px] leading-relaxed">
          Mythic Grounds is a browser-based simulator that lets you experiment
          with{" "}
          <em>Magic: the Gathering</em>
          {" "}booster formats — opening individual packs, running a six-pack
          sealed pool into a deck builder, and drafting a full eight-seat pod
          against AI bots — without spending money or shuffling sleeves.
        </p>
      </header>

      <Article
        title="1. What this site is"
        body={
          <>
            <p>
              Mythic Grounds is a browser-based pack-opening simulator for{" "}
              <em>Magic: the Gathering</em>. It generates randomized booster
              contents using publicly-documented pack composition rules, draws
              card data and artwork from{" "}
              <a
                href="https://scryfall.com/docs/api"
                className="underline decoration-dotted underline-offset-4 text-[var(--color-fg)]"
                target="_blank"
                rel="noopener noreferrer"
              >
                Scryfall&rsquo;s public API
              </a>
              , and renders the result as a visual experience. Your binder lives
              in your browser&rsquo;s localStorage — nothing is sent anywhere,
              nothing is sold, and nothing you do here affects any real
              collection or account.
            </p>
            <p>
              The randomness is real but the cards are not. No physical product
              changes hands, no entitlements are granted, no in-game currency
              is involved.
            </p>
          </>
        }
      />

      <Article
        title="2. Relationship with Wizards of the Coast"
        body={
          <>
            <p>
              Mythic Grounds is <strong>not</strong> affiliated with, endorsed by,
              sponsored by, or specifically approved by Wizards of the Coast
              LLC or its parent companies. It is intended as fan-made content
              under{" "}
              <a
                href="https://company.wizards.com/en/legal/fancontentpolicy"
                className="underline decoration-dotted underline-offset-4 text-[var(--color-fg)]"
                target="_blank"
                rel="noopener noreferrer"
              >
                Wizards&rsquo; Fan Content Policy
              </a>
              , which permits non-commercial fan websites that incorporate
              Wizards&rsquo; intellectual property provided certain conditions
              are met. Mythic Grounds aims to comply with those conditions:
            </p>
            <ul className="list-disc list-outside pl-5 space-y-1.5">
              <li>
                The site is clearly marked as unofficial and is not styled to
                resemble an official Wizards of the Coast product. Wizards&rsquo;
                logos and registered marks are not reproduced on the site.
              </li>
              <li>
                No payments, subscriptions, downloads, surveys, or email
                registrations are required to access any feature. The site
                is free to use and there is no paywall or advertising. A
                small optional &ldquo;Support&rdquo; button in the
                navigation opens an in-page Ko-fi tip panel (the panel
                is hosted by Ko-fi in an embedded frame; card-payment
                details are handled by Ko-fi and their payment processor,
                never by Mythic Grounds). The Fan Content Policy
                explicitly permits subsidizing fan content through
                donations &ldquo;so long as it doesn&rsquo;t interfere
                with the Community&rsquo;s access to your Fan Content,&rdquo;
                which it does not here: tipping is voluntary, never
                gated, and unlocks nothing additional on this site.
              </li>
              <li>
                The site, its source, and any future builds are not sold or
                licensed to third parties. The only money that may change
                hands flows through Ko-fi (and, for visitors browsing the
                source repository, GitHub Sponsors), voluntarily, to the
                individual developer — not in exchange for access to
                Mythic Grounds, which remains free.
              </li>
              <li>
                Mythic Grounds is a visual simulator that displays randomized
                booster contents using publicly-documented pack-composition
                rules. It does not implement Magic&rsquo;s gameplay rules and
                is not a substitute for, replacement for, or alternative
                client to the actual game.
              </li>
            </ul>
            <p>
              <em>Magic: the Gathering</em>, the Magic logo, the mana symbols,
              the card frame, the names of sets, characters, planeswalkers,
              and individual cards, and the rules of the game are trademarks
              and/or copyrighted works of Wizards of the Coast LLC. Any
              Wizards-owned trademarks that appear in incorporated card text
              or imagery are retained without alteration.
            </p>
            <p className="text-[var(--color-ink-muted)] italic">
              Mythic Grounds is unofficial Fan Content permitted under the Fan
              Content Policy. Not approved/endorsed by Wizards. Portions of
              the materials used are property of Wizards of the Coast.
              &copy;Wizards of the Coast LLC.
            </p>
            <p>
              If you are at Wizards of the Coast and would like something here
              taken down or modified, please reach out via the contact section
              below and we will act promptly.
            </p>
          </>
        }
      />

      <Article
        title="3. Card data &amp; imagery"
        body={
          <>
            <p>
              All card text, pricing, set metadata, and card images shown here
              are retrieved at request time from{" "}
              <a
                href="https://scryfall.com"
                className="underline decoration-dotted underline-offset-4 text-[var(--color-fg)]"
                target="_blank"
                rel="noopener noreferrer"
              >
                Scryfall
              </a>
              , which generously makes this data available under its{" "}
              <a
                href="https://scryfall.com/docs/api"
                className="underline decoration-dotted underline-offset-4 text-[var(--color-fg)]"
                target="_blank"
                rel="noopener noreferrer"
              >
                API terms
              </a>
              . We do not host card images or card text ourselves; we link to
              and request them from Scryfall.
            </p>
            <p>
              Scryfall is itself an independent project not affiliated with
              Wizards of the Coast. Card image copyrights belong to their
              respective artists and to Wizards of the Coast.
            </p>
          </>
        }
      />

      <Article
        title="4. Draft-bot tuning &amp; 17Lands data"
        body={
          <>
            <p>
              <strong>Card pick data retrieved from{" "}
              <a
                href="https://www.17lands.com"
                className="underline decoration-dotted underline-offset-4 text-[var(--color-fg)]"
                target="_blank"
                rel="noopener noreferrer"
              >
                17Lands
              </a>
              .</strong>
            </p>
            <p>
              The AI bots in the Booster Draft experience consult per-card
              aggregate statistics — average pick number, games-in-hand
              win rate, and play rate — published by 17Lands, a community
              statistics project that collects anonymized draft and game
              data from MTG Arena Premier Draft players who opt in. Their
              aggregates help the bots pick like an experienced human
              drafter instead of a pure rarity-chase algorithm.
            </p>
            <p>
              17Lands data on this site is{" "}
              <strong>captured once and stored as static JSON</strong>{" "}
              alongside the rest of the source. The site does not query
              17Lands at runtime; refreshing the cached aggregates is a
              manual maintenance step performed from a local script that
              hits their public{" "}
              <code>card_ratings/data</code> endpoint a handful of times
              per set per refresh. This keeps load off their servers and
              respects their stated preference that third-party tools
              work from the public dataset rather than live API hits.
            </p>
            <p>
              Sets we have 17Lands aggregates for are marked with a small
              <span
                className="inline-block mx-1.5 px-1.5 py-px rounded text-[10px] tracking-[0.14em] uppercase font-bold align-middle"
                style={{
                  background: "rgba(123,57,252,0.28)",
                  color: "var(--accent-purple-light)",
                  border: "1px solid rgba(164,132,215,0.4)",
                  fontFamily: "var(--font-btn)",
                }}
              >
                17L
              </span>
              badge on the Booster Draft set picker — the only flow on
              this site that consumes the data — and the citation
              <em>&ldquo;Card pick data retrieved from 17Lands&rdquo;</em>{" "}
              is shown at the top of the Booster Draft landing page and on
              the per-set draft page whenever 17Lands data is in use. The
              pack-opening and Sealed flows do not consume 17Lands data,
              so the badge is omitted on those pickers to avoid implying
              attribution where none is warranted. Sets without the badge
              fall back to a rarity-based heuristic that doesn&rsquo;t
              reference any external data.
            </p>
            <p>
              17Lands is independent of Wizards of the Coast and of this
              project. The citation above is not an endorsement —{" "}
              <em>17Lands does not endorse Mythic Grounds or its findings</em>.
              We use their data in good faith for the non-commercial
              purposes described on this page, following the
              <a
                href="https://www.17lands.com/usage_guidelines"
                className="underline decoration-dotted underline-offset-4 text-[var(--color-fg)]"
                target="_blank"
                rel="noopener noreferrer"
              >
                {" "}17Lands usage guidelines
              </a>
              {" "}for citation and attribution. If you are with 17Lands
              and want this usage adjusted, please reach out via the
              contact section below.
            </p>
          </>
        }
      />

      <Article
        title="5. No commerce, no entitlements"
        body={
          <>
            <p>
              Mythic Grounds accepts no payments, sells no products, offers no
              subscriptions, and grants no in-game items or codes. Prices shown
              alongside opened cards are market estimates surfaced from Scryfall
              for entertainment and curiosity only — they are not offers, not
              quotes, and have no bearing on any transaction. The session
              &ldquo;Pulled vs Spent&rdquo; counter is a toy. Treat it as one.
            </p>
            <p>
              External links to retailers (when present) are provided for
              convenience. We do not control those sites and do not currently
              participate in any affiliate program through them. If that
              changes in the future, this page will say so explicitly.
            </p>
          </>
        }
      />

      <Article
        title="6. Your data &amp; privacy"
        body={
          <>
            <p>
              Mythic Grounds runs entirely in your browser. Your saved cards,
              holographic-style preference, and any other settings live in
              your browser&rsquo;s <code>localStorage</code> on this device.
              They are not transmitted to a server, not associated with any
              account, and not shared with third parties.
            </p>
            <p>
              The site fetches card data from Scryfall as you browse, which
              means Scryfall&rsquo;s servers see the same HTTP requests any
              other Scryfall-powered tool would generate.
            </p>
            <p>
              The site uses Vercel&rsquo;s built-in analytics to count
              anonymous pageviews and basic performance metrics (Web Vitals)
              so the maintainers know which pages are slow or broken. Vercel
              Analytics does not set cookies, does not collect personal
              identifiers, and does not build a profile that can identify
              you — see{" "}
              <a
                href="https://vercel.com/docs/analytics/privacy-policy"
                className="underline decoration-dotted underline-offset-4 text-[var(--color-fg)]"
                target="_blank"
                rel="noopener noreferrer"
              >
                Vercel&rsquo;s analytics privacy notice
              </a>
              {" "}for the full description. There is no advertising, no
              third-party tracking pixels, and no cross-site retargeting.
            </p>
            <p>
              Clearing your browser&rsquo;s storage for this site will erase
              your binder. There is no remote backup. Treat the binder as a
              local toy, not a record of value.
            </p>
          </>
        }
      />

      <Article
        title="7. &ldquo;As is&rdquo;"
        body={
          <>
            <p>
              Mythic Grounds is provided as-is, without warranty of any kind,
              express or implied, including but not limited to the warranties
              of merchantability, fitness for a particular purpose, and
              non-infringement. The maintainers are not liable for any claim,
              damages, or other liability arising from use of the site,
              including but not limited to anyone treating a simulated rare
              pull as if it were a real one.
            </p>
          </>
        }
      />

      <Article
        title="8. Contact &amp; takedown requests"
        body={
          <>
            <p>
              If you represent a rights holder and want something removed, if
              you spot an error in attribution, or if you have any other legal
              question, please open an issue on the project&rsquo;s
              repository or reach out by email. We will respond promptly and
              in good faith.
            </p>
          </>
        }
      />

      <footer className="mt-14 pt-6 border-t border-[var(--color-line)] text-[13px] text-[var(--color-ink-muted)] flex flex-wrap gap-4 items-center justify-between">
        <p>
          This page is not legal advice. It is a sincere attempt to set
          expectations.
        </p>
        <Link
          href="/"
          className="underline decoration-dotted underline-offset-4 text-[var(--color-ink)] hover:text-[var(--color-fg)]"
        >
          ← Back to Mythic Grounds
        </Link>
      </footer>
    </section>
  );
}

function Article({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <article className="mb-9">
      <h2
        className="font-display text-2xl text-[var(--color-fg)] mb-3"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {title}
      </h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-[var(--color-ink)]">
        {body}
      </div>
    </article>
  );
}
