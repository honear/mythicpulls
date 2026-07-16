import type { Metadata } from "next";
import { Cabin, Geist, Instrument_Serif, Manrope } from "next/font/google";
import localFont from "next/font/local";
import Link from "next/link";
import "./globals.css";
import { SiteHeader } from "./_components/SiteHeader";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

/* All families load through next/font so they're self-hosted from
   /_next/static and inlined as @font-face at build time — no
   render-blocking requests to fonts.googleapis.com / api.fontshare.com
   (those two stylesheets alone delayed the hero LCP by ~2s on mobile).
   Each exposes a CSS variable consumed by the font stacks in
   globals.css. */
const geist = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

// Display serif for the hero headline (italic for connector words).
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

// Nav / UI chrome.
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// Buttons & pill badge.
const cabin = Cabin({
  variable: "--font-cabin",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

/* General Sans (display) — Fontshare has no next/font provider, so the
   woff2 weights are vendored in app/fonts/ (Fontshare's free license
   permits self-hosting). */
const generalSans = localFont({
  src: [
    { path: "./fonts/GeneralSans-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/GeneralSans-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/GeneralSans-Semibold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/GeneralSans-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-general-sans",
  display: "swap",
});

const fontVariables = [
  geist.variable,
  instrumentSerif.variable,
  manrope.variable,
  cabin.variable,
  generalSans.variable,
].join(" ");

/**
 * Resolve the absolute site URL used to make relative image references
 * (notably the auto-discovered `opengraph-image`) into shareable URLs.
 * Resolution order:
 *   1. NEXT_PUBLIC_SITE_URL — set in Vercel's project env vars to
 *      `https://threetreecity.com` so Open Graph previews and the
 *      canonical link tag point at the custom domain. Without this,
 *      Vercel's auto-injected env (step 2) would put the share URL
 *      on `*.vercel.app`, which is what Fortinet / enterprise URL
 *      filters treat as untrusted shared hosting.
 *   2. VERCEL_PROJECT_PRODUCTION_URL — automatically populated by Vercel
 *      on production builds; matches the canonical `*.vercel.app` host.
 *   3. Localhost fallback so `npm run dev` doesn't crash.
 */
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL &&
    `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
  "http://localhost:3000";

const SHARE_DESCRIPTION =
  "Open Magic: the Gathering booster packs, run sealed builds, and practice drafts in your browser. A free fan project powered by Scryfall and 17Lands.";

export const metadata: Metadata = {
  // metadataBase turns the auto-discovered opengraph-image (and any
  // other relative URL we hand to the metadata config) into an absolute
  // URL that Slack, iMessage, Discord, Twitter, etc. can fetch. Without
  // it Next.js falls back to localhost and the social preview breaks in
  // production.
  metadataBase: new URL(siteUrl),
  title: {
    // Default title used on pages that don't override metadata.title.
    default: "Three Tree City — open Magic packs, draft & sealed",
    // Pages that set their own title get this template appended so the
    // tab/Google result still carries the brand.
    template: "%s · Three Tree City",
  },
  description: SHARE_DESCRIPTION,
  applicationName: "Three Tree City",
  // Open Graph tags drive previews on Facebook, LinkedIn, Slack,
  // iMessage, Discord, and most chat clients. The actual image is
  // picked up automatically from `app/opengraph-image.tsx`; we don't
  // list it here so Next can manage the width/height/type tags too.
  openGraph: {
    type: "website",
    siteName: "Three Tree City",
    title: "Three Tree City — open Magic packs, draft & sealed",
    description: SHARE_DESCRIPTION,
    locale: "en_US",
    url: "/",
  },
  // Twitter / X uses its own card flavour; `summary_large_image` is the
  // wide banner format that matches the 1200×630 OG image dimensions.
  twitter: {
    card: "summary_large_image",
    title: "Three Tree City — open Magic packs, draft & sealed",
    description: SHARE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${fontVariables} h-full antialiased`}>
      {/* Browser extensions (VPN/ad-blockers/proxies) commonly inject
          attributes on <body> before React hydrates — e.g. the user's
          `inject_newvt_svd="true"`. React's mismatch warning isn't
          actionable for us in those cases, so suppress just the body
          comparison. Real hydration mismatches inside our tree still
          warn normally. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <SiteHeader />
        <main className="flex-1 flex flex-col">{children}</main>
        <SiteFooter />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}

function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-[var(--color-line)] bg-[var(--color-bg-soft)]">
      <div className="mx-auto max-w-7xl w-full px-6 py-6 flex flex-col md:flex-row gap-3 md:items-center md:justify-between text-sm text-[var(--color-ink)]">
        <p>
          Card data &amp; imagery courtesy of{" "}
          <a
            href="https://scryfall.com/docs/api"
            className="text-[var(--color-fg)] underline decoration-dotted underline-offset-4"
            target="_blank" rel="noopener noreferrer"
          >
            Scryfall
          </a>
          . Three Tree City is an unofficial fan project.
        </p>
        <div className="flex flex-wrap items-center gap-3 md:gap-4">
          <Link
            href="/legal"
            className="text-[var(--color-fg)] underline decoration-dotted underline-offset-4 hover:text-white"
          >
            Legal &amp; disclosures
          </Link>
          <span className="label-caps text-[var(--color-ink-muted)]">
            For entertainment only · No purchase
          </span>
        </div>
      </div>
    </footer>
  );
}
