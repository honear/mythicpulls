"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Grid3x3, Menu, PackageOpen, Swords, Users, X } from "lucide-react";
import { SupportButton } from "./SupportButton";
// HoloToggle moved out of the site nav into the PackOpener's MoneyStrip.
// Reasoning: the holo style only affects revealed cards, so it lives best
// alongside the rip control instead of crowding the top-level nav.

/**
 * Single global header used across every page (including home).
 *
 * Layout above the `sm` breakpoint: wordmark on the left, four pills on
 * the right — HoloToggle, "Open packs", "Practice Draft",
 * "Practice Sealed", "My binder".
 *
 * Mobile (`<640px`): the wordmark stays put, the navigation pills
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
  // "Open packs" routes to /sets — the set picker lives there since
  // the homepage redesign moved off the catalog grid. Highlight on any
  // /sets/* path (the picker itself and any /sets/<code> child).
  const onOpenPacks = pathname.startsWith("/sets");
  const onPuzzle = pathname.startsWith("/connections");

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
          aria-label="Three Tree City home"
          className="flex items-center gap-2.5 group"
        >
          <Logomark />
          <span
            className="text-[15px] sm:text-[16px] font-semibold tracking-tight text-[var(--color-fg)]"
            style={{ fontFamily: "var(--font-ui)" }}
          >
            Three Tree City
          </span>
        </Link>

        {/* Desktop / tablet nav — hidden on phones. Order is:
              Support · Open packs · Practice Draft · Practice Sealed · My binder
            The "Support" pill sits FIRST (leftmost) as a small,
            visually-distinct ask that doesn't compete with the purple
            play CTAs. Ko-fi accepts guest tips without requiring the
            donor to have an account. Donations are explicitly allowed
            by the Wizards Fan Content Policy. */}
        <div className="hidden sm:flex items-center gap-2.5">
          <SupportButton variant="desktop" />
          <Link
            href="/sets"
            aria-current={onOpenPacks ? "page" : undefined}
            className="inline-flex items-center gap-2 h-[38px] pl-3 pr-4 rounded-[10px] text-[14px] font-medium transition-all"
            style={{
              background: "var(--accent-purple)",
              color: "white",
              fontFamily: "var(--font-btn)",
              boxShadow:
                "0 8px 20px -8px var(--accent-purple-glow), inset 0 1px 0 rgba(255,255,255,0.18)",
            }}
          >
            <PackageOpen className="w-4 h-4" />
            {/* Short label below lg so the four nav pills never wrap to
                two lines on narrow viewports (640-1024px). */}
            <span className="hidden lg:inline whitespace-nowrap">Open packs</span>
            <span className="lg:hidden">Packs</span>
          </Link>
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
            <span className="hidden lg:inline whitespace-nowrap">Practice Draft</span>
            <span className="lg:hidden">Draft</span>
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
            <span className="hidden lg:inline whitespace-nowrap">Build Sealed</span>
            <span className="lg:hidden">Sealed</span>
          </Link>
          <Link
            href="/connections"
            aria-current={onPuzzle ? "page" : undefined}
            className="inline-flex items-center gap-2 h-[38px] pl-3 pr-4 rounded-[10px] text-[14px] font-medium transition-all"
            style={{
              background: "var(--accent-purple)",
              color: "white",
              fontFamily: "var(--font-btn)",
              boxShadow:
                "0 8px 20px -8px var(--accent-purple-glow), inset 0 1px 0 rgba(255,255,255,0.18)",
            }}
          >
            <Grid3x3 className="w-4 h-4" />
            <span className="hidden lg:inline whitespace-nowrap">Daily Puzzle</span>
            <span className="lg:hidden">Puzzle</span>
          </Link>
          <Link
            href="/collection"
            aria-current={onCollection ? "page" : undefined}
            className="hero-pill"
            style={{ paddingLeft: 14 }}
          >
            <span className="hidden lg:inline whitespace-nowrap">My binder</span>
            <span className="lg:hidden">Binder</span>
          </Link>
        </div>

        {/* Mobile chrome — Binder pill + hamburger drawer for everything
            else (Play Draft, Play Sealed, Holo Style). The drawer is
            portalled to document.body so the header's backdrop-filter
            doesn't trap its fixed-position children. */}
        <div className="flex sm:hidden items-center gap-2">
          <Link
            href="/collection"
            aria-current={onCollection ? "page" : undefined}
            aria-label="My binder"
            // h-11 on mobile = 44px, the iOS HIG minimum tap target.
            className="inline-flex items-center justify-center h-11 px-3 rounded-[10px] text-[13px] font-medium transition-colors hover:bg-white/10 border border-[var(--color-line)]"
            style={{
              color: "var(--color-fg)",
              fontFamily: "var(--font-ui)",
            }}
          >
            Binder
          </Link>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-controls="site-mobile-menu"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            // w-11 h-11 = 44×44px tap target.
            className="grid place-items-center w-11 h-11 rounded-[10px] border border-[var(--color-line)] transition-colors hover:bg-white/10"
            style={{ color: "var(--color-fg)" }}
          >
            {menuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
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
              href="/sets"
              role="menuitem"
              aria-current={onOpenPacks ? "page" : undefined}
              className="inline-flex items-center gap-2 h-11 px-4 rounded-[10px] text-[15px] font-medium"
              style={{
                background: "var(--accent-purple)",
                color: "white",
                fontFamily: "var(--font-btn)",
                boxShadow:
                  "0 8px 20px -8px var(--accent-purple-glow), inset 0 1px 0 rgba(255,255,255,0.18)",
              }}
            >
              <PackageOpen className="w-4 h-4" />
              Open packs
            </Link>
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
              Practice Draft
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
              Practice Sealed
            </Link>
            <Link
              href="/connections"
              role="menuitem"
              aria-current={onPuzzle ? "page" : undefined}
              className="inline-flex items-center gap-2 h-11 px-4 rounded-[10px] text-[15px] font-medium"
              style={{
                background: "var(--accent-purple)",
                color: "white",
                fontFamily: "var(--font-btn)",
                boxShadow:
                  "0 8px 20px -8px var(--accent-purple-glow), inset 0 1px 0 rgba(255,255,255,0.18)",
              }}
            >
              <Grid3x3 className="w-4 h-4" />
              Daily Puzzle
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
            <SupportButton variant="mobile" />
          </div>
        </>,
        document.body,
      )}
    </header>
  );
}

/**
 * Brand mark — the tree-of-life logo shared with the homepage hero
 * and the favicon (see public/threetreecity_logo.svg). Loaded as a
 * cached `<img>` rather than inline so the same asset serves header,
 * landing, and any future surface without duplicating the 60-odd
 * paths into the JS bundle. A tight drop-shadow keeps the mark
 * legible against the header's translucent backdrop.
 */
function Logomark() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/threetreecity_logo.svg?v=tree-grad"
      alt=""
      width={28}
      height={28}
      aria-hidden
      draggable={false}
      style={{
        filter: "drop-shadow(0 1px 2px rgba(0, 0, 0, 0.45))",
      }}
    />
  );
}
