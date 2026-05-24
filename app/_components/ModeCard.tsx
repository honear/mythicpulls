// No "use client" — all interaction is pure CSS (group-hover, focus
// ring). Marking this as a Server Component lets the parent pass the
// Lucide icon component as a prop without tripping React's "functions
// cannot be passed to Client Components" serialization guard.

import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Big card-shaped CTA used on the homepage. Three of these (one per
 * mode) form the centerpiece of the landing: Open a pack, Practice
 * draft, Practice sealed.
 *
 * Visual cohesion:
 *   - 63:88 aspect ratio matches a real Magic card, tying the CTAs to
 *     the product's core visual.
 *   - Background is a heavily darkened art crop with a vertical
 *     gradient overlay so the foreground copy stays legible regardless
 *     of which art the card uses.
 *   - Hover lift + subtle scale + glow echo the `lift` interaction on
 *     SetTile, so the CTAs feel kin to the existing tile aesthetic.
 *
 * Content slots:
 *   - icon (Lucide) — top-left badge in a glass chip
 *   - eyebrow (e.g. "~30 seconds") — small label-caps text under icon
 *   - title (e.g. "Open a pack")
 *   - description (one or two short lines)
 *   - href — where the CTA navigates
 *
 * Width is uncontrolled — the parent layout grid sizes us. We just
 * fill the slot at 63:88. On mobile the parent stacks us full-width.
 */

export interface ModeCardProps {
  /** Header chip icon (Lucide component). */
  icon: LucideIcon;
  /** Caption / time-estimate above the title (e.g. "~10 minutes"). */
  eyebrow: string;
  /** Card-face heading. */
  title: string;
  /** One-liner or two-liner under the title; supports inline emphasis
   *  via the `<em>` element so callers can highlight a phrase. */
  description: ReactNode;
  /** Bottom call-to-action verb (e.g. "Start opening", "Run a draft"). */
  cta: string;
  /** Navigation target. */
  href: string;
  /** Background art-crop URL. Brightened art + gradient overlay applied
   *  on top so the foreground copy still reads cleanly. */
  artUrl?: string;
  /** Credit for the artist behind `artUrl`. Rendered as a small
   *  "Art by <X>" line in the bottom-right corner — honors the art
   *  we're using as atmosphere on a free fan project. Optional;
   *  hidden when null/undefined. */
  artist?: string | null;
}

export function ModeCard({
  icon: Icon,
  eyebrow,
  title,
  description,
  cta,
  href,
  artUrl,
  artist,
}: ModeCardProps) {
  return (
    <Link
      href={href}
      className="group relative block aspect-[63/88] rounded-2xl overflow-hidden lift focus:outline-none focus:ring-2 focus:ring-[var(--accent-purple-light)] focus:ring-offset-2 focus:ring-offset-[var(--color-bg)]"
      aria-label={`${title}. ${cta}.`}
    >
      {/* Background art crop. Base brightness already lifted to
          what the previous hover state was (0.85), so the art reads
          clearly at rest. Hover takes it another ~50% above that
          (1.25) — past 1.0 means amplifying beyond the source, so
          the painting "lights up" visibly on hover. Filter values
          are class-based (not inline `style`) so the group-hover
          variant can actually override them. */}
      {artUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={artUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 w-full h-full object-cover transition-all duration-700 group-hover:scale-105 [filter:brightness(0.85)_saturate(1.05)_contrast(1.05)] group-hover:[filter:brightness(1.25)_saturate(1.12)_contrast(1.05)]"
        />
      )}

      {/* Gradient + vignette overlay. Two layers:
          - top→bottom gradient deepens the bottom so the CTA pill is
            always on a dark base
          - radial vignette darkens the corners and keeps the eye
            on the center column where the copy lives */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(180deg, rgba(13,8,32,0.35) 0%, rgba(13,8,32,0.55) 55%, rgba(13,8,32,0.92) 100%), radial-gradient(120% 90% at 50% 40%, transparent 0%, rgba(13,8,32,0.45) 80%)",
        }}
      />

      {/* 1px inner border in deep purple — gives the card a defined
          edge against the page background. Inset so it doesn't fight
          with the rounded clip. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none rounded-2xl"
        style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)" }}
      />

      {/* Foreground content stack. Padding scales with the card width
          so the layout reads cleanly at every breakpoint. */}
      <div className="relative h-full flex flex-col p-5 sm:p-6 md:p-7">
        {/* Top: icon chip + eyebrow */}
        <div className="flex items-start gap-3">
          <span className="grid place-items-center w-10 h-10 rounded-xl liquid-glass shrink-0">
            <Icon className="w-5 h-5 text-[var(--color-fg)]" />
          </span>
          <p
            className="label-caps text-[var(--color-ink-muted)] mt-2.5"
            style={{ fontFamily: "var(--font-ui)" }}
          >
            {eyebrow}
          </p>
        </div>

        {/* Middle: title + description. Flex-1 pushes the CTA pill to
            the bottom regardless of how much description text there is. */}
        <div className="flex-1 flex flex-col justify-end gap-2 sm:gap-3">
          <h2
            className="font-display text-[26px] sm:text-[30px] md:text-[34px] leading-[1.02] text-[var(--color-fg)] balance"
          >
            {title}
          </h2>
          <p className="text-[14px] sm:text-[15px] leading-snug text-white/75 max-w-[28ch]">
            {description}
          </p>
        </div>

        {/* Bottom: CTA pill + optional artist credit. The pill keeps
            the primary visual focus; the credit sits in the corner
            in muted text so it honors the artist without competing
            with the CTA. */}
        <div className="mt-5 sm:mt-6 flex items-end justify-between gap-3">
          <span
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-[13px] font-semibold tracking-wide transition-all group-hover:brightness-110"
            style={{
              background: "var(--accent-purple)",
              color: "white",
              fontFamily: "var(--font-btn)",
              boxShadow:
                "0 8px 20px -8px var(--accent-purple-glow), inset 0 1px 0 rgba(255,255,255,0.18)",
            }}
          >
            {cta}
            <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
          {artist && (
            <p
              className="text-[10px] tracking-wide text-white/55 text-right leading-tight pb-1 max-w-[40%] truncate"
              style={{ fontFamily: "var(--font-ui)" }}
              title={`Art by ${artist}`}
            >
              Art by{" "}
              <span className="text-white/75">{artist}</span>
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
