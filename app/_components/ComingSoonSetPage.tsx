import Link from "next/link";
import { CalendarClock, ExternalLink } from "lucide-react";
import type { ScryfallSet } from "@/lib/scryfall";
import { getManaPoolPackUrl } from "@/lib/manapool";

/**
 * Teaser page for a set inside the preview lookahead window but ahead
 * of its street date (isComingSoonSet in lib/scryfall.ts). Rendered by
 * all three per-set routes — /sets/[code], /sealed/[code], and
 * /draft/[code] — in place of their normal flows, so an unreleased
 * set is visible (and preorderable) everywhere but openable nowhere.
 * The gate lifts by itself on release day; the release-week pool
 * re-bake (scripts/build-set-cards.mjs) is what actually fills the
 * packs, so run that before/on street date.
 *
 * Server component — no client JS. The Mana Pool preorder button uses
 * the same static-price map as the MoneyStrip (lib/manapool.ts) and
 * hides itself when Mana Pool doesn't carry the product yet.
 */
export function ComingSoonSetPage({
  set,
  backHref,
  backLabel,
}: {
  set: ScryfallSet;
  /** Where the breadcrumb escapes to — the picker this route belongs
   *  to ("/", "/sealed", "/draft"). */
  backHref: string;
  backLabel: string;
}) {
  // released_at is guaranteed by the isComingSoonSet gate; the "soon"
  // fallback only defends against a mis-wired caller.
  const releaseDate = set.released_at
    ? new Date(`${set.released_at}T00:00:00Z`).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      })
    : "soon";
  // Preorder link: prefer the Play Booster listing, fall back to
  // Collector. Null (product not stocked yet) hides the button.
  const preorderUrl =
    getManaPoolPackUrl(set.code, "play") ?? getManaPoolPackUrl(set.code, "collector");

  return (
    <div className="mx-auto max-w-7xl w-full px-4 sm:px-6 pt-24 sm:pt-28 md:pt-32 pb-16 sm:pb-24">
      <Link
        href={backHref}
        className="label-caps text-[var(--color-ink-muted)] hover:text-[var(--color-fg)] transition-colors"
      >
        ← {backLabel}
      </Link>
      <div className="flex items-start gap-3 sm:gap-5 mt-3 sm:mt-4">
        {set.icon_svg_uri && (
          <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-xl grid place-items-center shrink-0 liquid-panel">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={set.icon_svg_uri}
              alt=""
              className="w-7 h-7 sm:w-9 sm:h-9 object-contain"
              style={{ filter: "brightness(0) invert(1)" }}
            />
          </div>
        )}
        <div className="min-w-0">
          <p className="label-caps text-[var(--color-ink-muted)]">
            {set.code.toUpperCase()} · {set.released_at?.slice(0, 4) ?? ""}
          </p>
          <h1 className="font-display text-[1.7rem] sm:text-[2.2rem] md:text-6xl text-[var(--color-fg)] mt-1 sm:mt-2 leading-[0.95] balance">
            {set.name}
          </h1>
          <p className="text-[var(--color-ink)] mt-2">
            {set.card_count} cards previewed so far ·{" "}
            {set.set_type.replace(/_/g, " ")}
          </p>
        </div>
      </div>

      <div className="mt-8 sm:mt-10 max-w-xl liquid-panel rounded-2xl p-6 sm:p-8">
        <span
          className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.18em] uppercase font-bold px-2 py-1 rounded"
          style={{
            background: "rgba(245,158,11,0.16)",
            color: "#fbbf24",
            border: "1px solid rgba(245,158,11,0.35)",
            fontFamily: "var(--font-btn)",
          }}
        >
          <CalendarClock className="w-3 h-3" />
          Coming soon
        </span>
        <h2 className="font-display text-xl sm:text-2xl text-[var(--color-fg)] mt-3 balance">
          Packs open here on {releaseDate}.
        </h2>
        <p className="mt-2 text-[15px] leading-snug text-[var(--color-ink)]" style={{ fontFamily: "var(--font-ui)" }}>
          Preview season is underway — the card pool fills out daily as
          Wizards reveals the set. Rip buttons, Sealed, and Draft unlock
          the moment the full set releases.
        </p>
        {preorderUrl && (
          <a
            href={preorderUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-full text-white transition-colors hover:opacity-90"
            style={{ background: "var(--accent-purple)", fontFamily: "var(--font-btn)" }}
          >
            Preorder on Mana Pool
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}
