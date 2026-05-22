import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Legal & disclosures — Mythic Pulls",
  description:
    "Terms of use, trademark acknowledgments, and the nature of Mythic Pulls as an unofficial fan project.",
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
    <section className="mx-auto max-w-3xl w-full px-6 py-14 md:py-20">
      <header className="mb-10">
        <p className="label-caps text-[var(--color-ink-muted)] mb-3">
          Disclosures · last updated 2026-05
        </p>
        <h1
          className="font-display text-4xl md:text-5xl text-[var(--color-fg)] leading-tight"
        >
          Legal &amp; the nature of Mythic Pulls
        </h1>
        <p className="mt-4 text-[var(--color-ink)] text-[15px] leading-relaxed">
          Mythic Pulls is a non-commercial fan project. It exists to scratch a
          very specific itch — the dopamine of cracking a booster — without
          touching a wallet or a sleeve. This page is a plain-language tour of
          what that means legally, who owns what, and how to reach us.
        </p>
      </header>

      <Article
        title="1. What this site is"
        body={
          <>
            <p>
              Mythic Pulls is a browser-based pack-opening simulator for{" "}
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
              Mythic Pulls is <strong>not</strong> affiliated with, endorsed by,
              sponsored by, or specifically approved by Wizards of the Coast
              LLC or its parent companies. We are not part of, connected to, or
              representing Wizards of the Coast in any way.
            </p>
            <p>
              <em>Magic: the Gathering</em>, the Magic logo, the mana symbols,
              the card frame, the names of sets, characters, planeswalkers, and
              individual cards, and the rules of the game are trademarks
              and/or copyrighted works of Wizards of the Coast LLC. All such
              elements are used here under the spirit of Wizards&rsquo; Fan
              Content Policy for non-commercial fan creations.
            </p>
            <p className="text-[var(--color-ink-muted)] italic">
              Portions of the materials used are property of Wizards of the
              Coast. &copy;Wizards of the Coast LLC.
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
        title="4. No commerce, no entitlements"
        body={
          <>
            <p>
              Mythic Pulls accepts no payments, sells no products, offers no
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
        title="5. Your data &amp; privacy"
        body={
          <>
            <p>
              Mythic Pulls runs entirely in your browser. Your saved cards,
              holographic-style preference, and any other settings live in
              your browser&rsquo;s <code>localStorage</code> on this device.
              They are not transmitted to a server, not associated with any
              account, and not shared with third parties.
            </p>
            <p>
              The site fetches card data from Scryfall as you browse, which
              means Scryfall&rsquo;s servers see the same HTTP requests any
              other Scryfall-powered tool would generate. We do not run our own
              analytics, advertising, or tracking pixels.
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
        title="6. &ldquo;As is&rdquo;"
        body={
          <>
            <p>
              Mythic Pulls is provided as-is, without warranty of any kind,
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
        title="7. Contact &amp; takedown requests"
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
          ← Back to Mythic Pulls
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
