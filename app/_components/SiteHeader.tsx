"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Swords, Users } from "lucide-react";
import { HoloToggle } from "./HoloToggle";

/**
 * Single global header used across every page (including home).
 *
 * Layout above the `sm` breakpoint: wordmark on the left, three pills on
 * the right — HoloToggle, "Play Draft", "Play Sealed", "My binder".
 *
 * Mobile (`<640px`): the wordmark stays put, the three navigation pills
 * collapse behind a single hamburger button. A short popover slides down
 * showing every destination + the HoloToggle stacked vertically. We
 * deliberately keep the popover lightweight (no portal, no animation
 * library) — a single state flag toggles a `<div>` under the header.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  // Portal target only available after first mount in the browser. Until
  // then we don't render the mobile sheet (it's only shown via tap on the
  // hamburger anyway, which can't fire before hydration).
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => setPortalReady(true), []);
  const onCollection = pathname.startsWith("/collection");
  const onSealed = pathname.startsWith("/sealed");
  const onDraft = pathname.startsWith("/draft");

  // Auto-close the mobile menu on route change so navigating from inside
  // it doesn't leave the panel parked open over the next page.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Lock body scroll while the mobile sheet is open so the page underneath
  // doesn't scroll inside the menu.
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  return (
    <header
      className="fixed top-0 left-0 right-0 z-30"
      style={{
        // Subtle frosted-glass background so content scrolling beneath
        // the fixed header doesn't read straight through it. The hero
        // pages render their own deep-purple bg, so this stays mostly
        // invisible there; on inner pages it gives the nav a clean edge.
        background: "linear-gradient(180deg, rgba(13,8,32,0.86) 0%, rgba(13,8,32,0.62) 70%, rgba(13,8,32,0) 100%)",
        backdropFilter: "blur(10px) saturate(140%)",
        WebkitBackdropFilter: "blur(10px) saturate(140%)",
      }}
    >
      <nav className="w-full flex flex-row items-center justify-between py-4 sm:py-5 px-4 sm:px-6 md:px-10">
        <Link
          href="/"
          aria-label="Mythic Pulls home"
          className="flex items-center gap-2.5 group"
        >
          <Logomark />
          <span
            className="text-[15px] sm:text-[16px] font-semibold tracking-tight text-[var(--color-fg)]"
            style={{ fontFamily: "var(--font-ui)" }}
          >
            Mythic Pulls
          </span>
        </Link>

        {/* Desktop / tablet nav — hidden on phones. */}
        <div className="hidden sm:flex items-center gap-2.5">
          <HoloToggle />
          <Link
            href="/draft"
            aria-current={onDraft ? "page" : undefined}
            className="inline-flex items-center gap-2 h-[38px] pl-3 pr-4 rounded-[10px] text-[14px] font-medium transition-all"
            style={{
              background: "var(--accent-purple)",
              color: "white",
              fontFamily: "var(--font-btn)",
              boxShadow:
                "0 8px 20px -8px var(--accent-purple-glow), inset 0 1px 0 rgba(255,255,255,0.18)",
            }}
          >
            <Users className="w-4 h-4" />
            Play Draft
          </Link>
          <Link
            href="/sealed"
            aria-current={onSealed ? "page" : undefined}
            className="inline-flex items-center gap-2 h-[38px] pl-3 pr-4 rounded-[10px] text-[14px] font-medium transition-all"
            style={{
              background: "var(--accent-purple)",
              color: "white",
              fontFamily: "var(--font-btn)",
              boxShadow:
                "0 8px 20px -8px var(--accent-purple-glow), inset 0 1px 0 rgba(255,255,255,0.18)",
            }}
          >
            <Swords className="w-4 h-4" />
            Play Sealed
          </Link>
          <Link
            href="/collection"
            aria-current={onCollection ? "page" : undefined}
            className="hero-pill"
            style={{ paddingLeft: 14 }}
          >
            My binder
          </Link>
        </div>

        {/* Mobile chrome — only the Binder pill is exposed for now. The
            hamburger + popover drawer are deliberately deactivated until
            we land on a more refined mobile nav: the drawer wasn't
            reading well over the set grid, and the user explicitly asked
            for it to be off in the meantime. Sealed / Draft / Holo style
            are still reachable on desktop ≥ sm. */}
        <div className="flex sm:hidden items-center gap-2">
          <Link
            href="/collection"
            aria-current={onCollection ? "page" : undefined}
            aria-label="My binder"
            className="inline-flex items-center justify-center h-[38px] px-3 rounded-[10px] text-[13px] font-medium transition-colors hover:bg-white/10 border border-[var(--color-line)]"
            style={{
              color: "var(--color-fg)",
              fontFamily: "var(--font-ui)",
            }}
          >
            Binder
          </Link>
        </div>
      </nav>

      {/* Hairline divider — kept on every breakpoint. */}
      <div
        className="h-px w-full"
        style={{
          marginTop: 3,
          background:
            "linear-gradient(to right, transparent, rgba(164,132,215,0.22), transparent)",
        }}
      />

      {/* Mobile sheet — portalled onto document.body. The header sets
          `backdrop-filter`, which creates a new containing block for any
          `position: fixed` descendants — meaning a backdrop rendered as
          a child of <header> gets clipped to the header's box (74px tall)
          instead of covering the viewport. Portaling to body sidesteps
          that. The panel uses an almost-opaque deep purple background
          rather than the 3%-alpha `.liquid-panel` surface, since with
          the set grid behind we can't rely on the translucent treatment
          reading cleanly. */}
      {menuOpen && portalReady && createPortal(
        <>
          <button
            type="button"
            aria-label="Dismiss menu"
            onClick={() => setMenuOpen(false)}
            className="sm:hidden fixed inset-0 z-[1090] bg-black/70 backdrop-blur-md"
          />
          <div
            id="site-mobile-menu"
            className="sm:hidden fixed left-0 right-0 z-[1100] mx-4 rounded-2xl border p-3 flex flex-col gap-2"
            style={{
              top: 74, // header height: py-4 (16+16) + 38px button + 1px divider + ~3px breath
              background: "rgba(20, 14, 42, 0.96)",
              borderColor: "var(--color-line)",
              boxShadow: "0 20px 50px -20px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.05)",
              backdropFilter: "blur(18px) saturate(160%)",
              WebkitBackdropFilter: "blur(18px) saturate(160%)",
            }}
            role="menu"
          >
            <Link
              href="/draft"
              role="menuitem"
              aria-current={onDraft ? "page" : undefined}
              className="inline-flex items-center gap-2 h-11 px-4 rounded-[10px] text-[15px] font-medium"
              style={{
                background: "var(--accent-purple)",
                color: "white",
                fontFamily: "var(--font-btn)",
                boxShadow:
                  "0 8px 20px -8px var(--accent-purple-glow), inset 0 1px 0 rgba(255,255,255,0.18)",
              }}
            >
              <Users className="w-4 h-4" />
              Play Draft
            </Link>
            <Link
              href="/sealed"
              role="menuitem"
              aria-current={onSealed ? "page" : undefined}
              className="inline-flex items-center gap-2 h-11 px-4 rounded-[10px] text-[15px] font-medium"
              style={{
                background: "var(--accent-purple)",
                color: "white",
                fontFamily: "var(--font-btn)",
                boxShadow:
                  "0 8px 20px -8px var(--accent-purple-glow), inset 0 1px 0 rgba(255,255,255,0.18)",
              }}
            >
              <Swords className="w-4 h-4" />
              Play Sealed
            </Link>
            <Link
              href="/collection"
              role="menuitem"
              aria-current={onCollection ? "page" : undefined}
              className="inline-flex items-center h-11 px-4 rounded-[10px] text-[15px] font-medium border border-[var(--color-line)] hover:bg-white/5"
              style={{ color: "var(--color-fg)", fontFamily: "var(--font-ui)" }}
            >
              My binder
            </Link>
            <div className="flex items-center justify-between gap-3 px-1 pt-1">
              <span
                className="label-caps text-[var(--color-ink-muted)]"
                style={{ fontFamily: "var(--font-ui)" }}
              >
                Holo style
              </span>
              <HoloToggle />
            </div>
          </div>
        </>,
        document.body,
      )}
    </header>
  );
}

function Logomark() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id="hdr-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a484d7" />
          <stop offset="55%" stopColor="#7b39fc" />
          <stop offset="100%" stopColor="#4f17d4" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="12" stroke="url(#hdr-mark)" strokeWidth="2" />
      <circle cx="16" cy="16" r="4" fill="url(#hdr-mark)" />
    </svg>
  );
}
