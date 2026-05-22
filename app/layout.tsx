import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "./_components/SiteHeader";

const geist = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Mythic Pulls — open Magic packs",
  description:
    "An elegant Magic: the Gathering booster-opening experience powered by Scryfall.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <head>
        {/* General Sans (display) from Fontshare */}
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link
          href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700&display=swap"
          rel="stylesheet"
        />
        {/* Cinzel (hero brand serif) from Google Fonts */}
        <link
          href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col">
        <SiteHeader />
        <main className="flex-1 flex flex-col">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}

function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-[var(--color-line)] bg-[var(--color-bg-soft)]">
      <div className="mx-auto max-w-7xl w-full px-6 py-6 flex flex-col md:flex-row gap-2 md:items-center md:justify-between text-sm text-[var(--color-ink)]">
        <p>
          Card data &amp; imagery courtesy of{" "}
          <a
            href="https://scryfall.com/docs/api"
            className="text-[var(--color-fg)] underline decoration-dotted underline-offset-4"
            target="_blank" rel="noreferrer"
          >
            Scryfall
          </a>
          . Mythic Pulls is an unofficial fan project.
        </p>
        <p className="label-caps text-[var(--color-ink-muted)]">For entertainment only · No purchase</p>
      </div>
    </footer>
  );
}
