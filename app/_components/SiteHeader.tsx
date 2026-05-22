"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, Menu, X } from "lucide-react";

const NAV: { href: string; label: string; chevron?: boolean }[] = [
  { href: "/", label: "Sets", chevron: true },
  { href: "/collection", label: "Binder" },
  { href: "#about", label: "Guide", chevron: true },
];

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Home renders its own navbar inside <Hero />
  if (pathname === "/") return null;

  return (
    <>
      <header className="absolute top-0 left-0 right-0 z-30">
        <nav className="w-full flex flex-row items-center justify-between py-5 px-6 md:px-8">
          <Link href="/" aria-label="Mythic Pulls home" className="flex items-center gap-2.5">
            <Logomark />
            <span className="text-[16px] font-semibold tracking-tight font-display text-[var(--color-fg)]">
              Mythic Pulls
            </span>
          </Link>

          <ul className="hidden md:flex items-center gap-8">
            {NAV.map((item) => {
              const isActive =
                item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    className={`inline-flex items-center gap-1 text-[15px] transition-opacity hover:opacity-100 ${
                      isActive ? "text-[var(--color-fg)]" : "text-[var(--color-fg)]/80"
                    }`}
                  >
                    {item.label}
                    {item.chevron && <ChevronDown className="w-3.5 h-3.5" />}
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="flex items-center gap-3">
            <Link
              href="/collection"
              className="hidden sm:inline-flex btn-hero-secondary liquid-glass rounded-full px-4 py-2 text-[14px] font-medium"
            >
              My binder
            </Link>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="md:hidden relative flex items-center justify-center w-10 h-10 rounded-full btn-hero-secondary liquid-glass text-[var(--color-fg)] transition-all duration-300"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
            >
              <Menu
                className={`w-5 h-5 absolute transition-all duration-300 ${
                  menuOpen ? "opacity-0 rotate-90 scale-50" : "opacity-100 rotate-0 scale-100"
                }`}
              />
              <X
                className={`w-5 h-5 absolute transition-all duration-300 ${
                  menuOpen ? "opacity-100 rotate-0 scale-100" : "opacity-0 -rotate-90 scale-50"
                }`}
              />
            </button>
          </div>
        </nav>
        <div
          className="h-px w-full"
          style={{
            marginTop: 3,
            background:
              "linear-gradient(to right, transparent, rgba(245,244,240,0.18), transparent)",
          }}
        />
      </header>

      {/* Mobile drawer */}
      <div
        className={`md:hidden fixed inset-0 z-20 transition-opacity duration-300 ${
          menuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setMenuOpen(false)}
        aria-hidden
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      </div>
      <div
        className={`md:hidden fixed top-0 right-0 bottom-0 z-20 w-[85%] max-w-sm transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          menuOpen ? "translate-x-0" : "translate-x-full"
        }`}
        style={{ background: "var(--color-bg-soft)" }}
      >
        <div className="flex flex-col h-full pt-24 px-8 pb-8">
          <div className="flex flex-col gap-1">
            {NAV.map((link, i) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className={`text-2xl font-semibold text-[var(--color-fg)] py-4 border-b border-[var(--color-line)] transition-all duration-500 font-display ${
                  menuOpen ? "translate-x-0 opacity-100" : "translate-x-8 opacity-0"
                }`}
                style={{ transitionDelay: menuOpen ? `${150 + i * 70}ms` : "0ms" }}
              >
                {link.label}
              </Link>
            ))}
          </div>
          <div
            className={`mt-8 flex flex-col gap-4 transition-all duration-500 ${
              menuOpen ? "translate-x-0 opacity-100" : "translate-x-8 opacity-0"
            }`}
            style={{ transitionDelay: menuOpen ? "400ms" : "0ms" }}
          >
            <Link
              href="/collection"
              onClick={() => setMenuOpen(false)}
              className="text-center btn-hero-secondary liquid-glass rounded-full px-5 py-3 text-sm font-semibold"
            >
              My binder
            </Link>
          </div>
        </div>
      </div>
    </>
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
          <stop offset="0%" stopColor="#fcd34d" />
          <stop offset="55%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="12" stroke="url(#hdr-mark)" strokeWidth="2" />
      <circle cx="16" cy="16" r="4" fill="url(#hdr-mark)" />
    </svg>
  );
}
