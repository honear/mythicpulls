"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Single global header used across every page (including home). The earlier
 * version hid itself on `/` because the legacy Hero shipped its own navbar;
 * the new home layout has no embedded nav, so this header runs everywhere.
 *
 * Intentionally minimal: a wordmark on the left (links to home) and a
 * binder link on the right. No section nav — the set grid is one click
 * away on the home page and pack opening is the entire job of /sets/*.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const onCollection = pathname.startsWith("/collection");

  return (
    <header className="absolute top-0 left-0 right-0 z-30">
      <nav className="w-full flex flex-row items-center justify-between py-5 px-6 md:px-10">
        <Link
          href="/"
          aria-label="Mythic Pulls home"
          className="flex items-center gap-2.5 group"
        >
          <Logomark />
          <span
            className="text-[16px] font-semibold tracking-tight text-[var(--color-fg)]"
            style={{ fontFamily: "var(--font-ui)" }}
          >
            Mythic Pulls
          </span>
        </Link>

        <Link
          href="/collection"
          aria-current={onCollection ? "page" : undefined}
          className="hero-pill"
          style={{ paddingLeft: 14 }}
        >
          My binder
        </Link>
      </nav>
      <div
        className="h-px w-full"
        style={{
          marginTop: 3,
          background:
            "linear-gradient(to right, transparent, rgba(164,132,215,0.22), transparent)",
        }}
      />
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
