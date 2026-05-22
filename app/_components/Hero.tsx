"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import FadeLoopVideoBg from "./FadeLoopVideoBg";

/**
 * Background video URL. Empty by default so the design renders against the
 * dark-purple background; drop in any MP4 to enable the JS-driven fade loop.
 * Reference asset from the design spec:
 *   https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_065045_c44942da-53c6-4804-b734-f9e07fc22e08.mp4
 */
const HERO_VIDEO: string | undefined = undefined;

/* Six recent Magic sets, displayed in the bottom marquee with their Scryfall icons. */
const MARQUEE_SETS = [
  { code: "fdn", name: "Foundations" },
  { code: "blb", name: "Bloomburrow" },
  { code: "dsk", name: "Duskmourn" },
  { code: "otj", name: "Thunder Junction" },
  { code: "mh3", name: "Modern Horizons 3" },
  { code: "lci", name: "Lost Caverns" },
];

const NAV = [
  { href: "#sets", label: "Sets", chevron: true },
  { href: "#formats", label: "Formats", chevron: false },
  { href: "/collection", label: "Binder", chevron: false },
  { href: "#about", label: "Guide", chevron: true },
];

export function Hero() {
  return (
    <section
      data-screen-label="Hero"
      className="relative min-h-screen flex flex-col overflow-visible"
      style={{ background: "var(--hero-bg)", color: "var(--hero-fg)" }}
    >
      {/* Background video wrapper (clipped) */}
      <div className="absolute inset-0 overflow-hidden">
        <FadeLoopVideoBg
          src={HERO_VIDEO}
          className="absolute inset-0 w-full h-full object-cover"
        />
      </div>

      {/* Blurred overlay shape — centered behind content, not clipped */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-950 opacity-90"
        style={{ width: 984, height: 527, filter: "blur(82px)" }}
      />

      {/* Content layer */}
      <div className="relative z-10 flex flex-col flex-1">
        <Navbar />

        {/* Hero copy */}
        <div className="flex-1 flex items-center justify-center px-8">
          <div className="flex flex-col items-center text-center">
            <h1 className="hero-headline">
              <span style={{ color: "var(--hero-fg)" }}>Mythic </span>
              <span className="ai-grad">Pulls</span>
            </h1>
            <p
              className="text-lg leading-8 max-w-md opacity-80"
              style={{ color: "var(--hero-sub)", marginTop: 9 }}
            >
              Open Magic boosters with cinematic care.
              <br />
              Drop rates honored, every rip.
            </p>
            <Link
              href="#sets"
              className="btn-hero-secondary liquid-glass rounded-full text-[15px] font-medium inline-flex items-center justify-center"
              style={{ padding: "24px 29px", marginTop: 25 }}
            >
              Open pack
            </Link>
          </div>
        </div>

        <SetMarquee />
      </div>
    </section>
  );
}

function Navbar() {
  return (
    <header className="w-full">
      <nav className="w-full flex flex-row items-center justify-between py-5 px-6 md:px-8">
        {/* Logo */}
        <Link href="/" aria-label="Mythic Pulls home" className="flex items-center gap-2.5">
          <Logomark />
          <span
            className="text-[16px] font-semibold tracking-tight"
            style={{ color: "var(--hero-fg)", fontFamily: "var(--font-display)" }}
          >
            Mythic Pulls
          </span>
        </Link>

        {/* Center nav */}
        <ul className="hidden md:flex items-center gap-8">
          {NAV.map((item) => (
            <li key={item.label}>
              {item.href.startsWith("/") ? (
                <Link
                  href={item.href}
                  className="inline-flex items-center gap-1 text-[15px] transition-opacity hover:opacity-100"
                  style={{ color: "rgba(245, 244, 240, 0.9)" }}
                >
                  {item.label}
                  {item.chevron && <ChevronDown className="w-3.5 h-3.5" />}
                </Link>
              ) : (
                <a
                  href={item.href}
                  className="inline-flex items-center gap-1 text-[15px] transition-opacity hover:opacity-100"
                  style={{ color: "rgba(245, 244, 240, 0.9)" }}
                >
                  {item.label}
                  {item.chevron && <ChevronDown className="w-3.5 h-3.5" />}
                </a>
              )}
            </li>
          ))}
        </ul>

        {/* Right: My binder (was Sign Up) */}
        <Link
          href="/collection"
          className="btn-hero-secondary liquid-glass rounded-full px-4 py-2 text-[14px] font-medium"
        >
          My binder
        </Link>
      </nav>

      {/* 1px gradient divider */}
      <div
        className="h-px w-full"
        style={{
          marginTop: 3,
          background:
            "linear-gradient(to right, transparent, rgba(245,244,240,0.20), transparent)",
        }}
      />
    </header>
  );
}

function Logomark() {
  // Stylized concentric ring with center dot — same construction as the
  // design's placeholder, recolored to fit the dark hero.
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
        <linearGradient id="mp-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fcd34d" />
          <stop offset="55%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="12" stroke="url(#mp-mark)" strokeWidth="2" />
      <circle cx="16" cy="16" r="4" fill="url(#mp-mark)" />
    </svg>
  );
}

function SetMarquee() {
  // Duplicate the row so the animation loops seamlessly (translateX -50%).
  const renderRow = (ariaHidden = false) => (
    <div className="flex items-center gap-16 pr-16" aria-hidden={ariaHidden || undefined}>
      {MARQUEE_SETS.map((s) => (
        <div key={`${s.code}-${ariaHidden ? "b" : "a"}`} className="flex items-center gap-2 shrink-0">
          <span
            className="liquid-glass rounded-lg grid place-items-center"
            style={{ width: 24, height: 24 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://svgs.scryfall.io/sets/${s.code}.svg`}
              alt=""
              className="w-3.5 h-3.5"
              style={{ filter: "brightness(0) invert(1)" }}
            />
          </span>
          <span
            className="text-base font-semibold whitespace-nowrap"
            style={{ color: "var(--hero-fg)" }}
          >
            {s.name}
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="w-full" style={{ paddingBottom: 40 }}>
      <div className="max-w-5xl mx-auto px-8">
        <div className="flex items-center gap-12">
          {/* Left static text */}
          <div
            className="shrink-0 text-sm leading-snug"
            style={{ color: "rgba(245, 244, 240, 0.5)" }}
          >
            Drawing pulls from
            <br />
            sets across the multiverse
          </div>

          {/* Right: marquee */}
          <div className="flex-1 overflow-hidden marquee-mask">
            <div className="marquee-track flex items-center gap-16">
              {renderRow(false)}
              {renderRow(true)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
