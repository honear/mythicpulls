import type { NextConfig } from "next";

/**
 * Security response headers applied to every route.
 *
 * Notes on what's intentionally NOT here:
 *   - Content-Security-Policy: a meaningful CSP requires allowlisting
 *     Scryfall image hosts, Google Fonts / Fontshare stylesheet origins,
 *     and Tailwind's runtime inline styles. Done sloppily a CSP breaks
 *     the site silently; done well it's a separate hardening pass.
 *     Until that lands, the headers below are the minimum reasonable
 *     defaults for a no-auth static site.
 *   - Strict-Transport-Security: handled at the hosting layer (Vercel,
 *     etc.) which terminates TLS — setting it from the app would have
 *     no effect over HTTP and is redundant over HTTPS.
 */
const securityHeaders = [
  // Don't let other origins iframe us — defense against clickjacking.
  { key: "X-Frame-Options", value: "DENY" },
  // Browser must respect declared content types instead of sniffing.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Leak the bare-minimum referrer to other origins, full path on
  // same-origin navigations. Good default for a non-auth site.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Deny access to powerful features we don't use anywhere. If a
  // future feature needs e.g. clipboard-write, scope that one feature
  // narrowly instead of widening this list.
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  // Force-include the pre-baked card pools in every serverless function
  // that might read them. lib/scryfall.ts loads `data/set-cards/<code>.json`
  // via `fs.readFile` with a runtime-computed path — Next's static
  // analyzer can't see which files are actually read, so it skips them
  // when tracing. Listing the glob here makes Vercel package the full
  // directory with the function bundle. Without this every disk read
  // ENOENT-fails on Vercel and the runtime silently falls back to the
  // slow live Scryfall pagination.
  outputFileTracingIncludes: {
    "/sets/[code]": ["./data/set-cards/**/*.json.gz"],
    "/draft/[code]": ["./data/set-cards/**/*.json.gz"],
    "/sealed/[code]": ["./data/set-cards/**/*.json.gz"],
  },
  async headers() {
    return [
      {
        // Apply to every path.
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  // Allow the dev server to serve `_next/*` resources (HMR socket,
  // JS bundles) to phones / iPads on the same LAN. Without this,
  // Next.js 16 blocks cross-origin dev-resource requests from any
  // origin other than localhost — which means a phone hitting
  // `http://192.168.1.118:3000` gets the SSR HTML but the client JS
  // never loads, React doesn't hydrate, mobile-conditional hooks
  // stay at their SSR defaults, and every button is dead.
  //
  // Patterns use glob `*` wildcards (one segment each). The list
  // below covers the typical home / office LAN subnets without
  // exposing the dev server to the public internet. Dev-only; this
  // config has no effect on production builds.
  allowedDevOrigins: [
    // 192.168.x.x — most home routers
    "192.168.*.*",
    // 10.x.x.x — some home / corporate LANs
    "10.*.*.*",
    // 172.16.x.x – 172.31.x.x — uncommon but valid private range
    "172.16.*.*",
    "172.17.*.*",
    "172.18.*.*",
    "172.19.*.*",
    "172.20.*.*",
    "172.21.*.*",
    "172.22.*.*",
    "172.23.*.*",
    "172.24.*.*",
    "172.25.*.*",
    "172.26.*.*",
    "172.27.*.*",
    "172.28.*.*",
    "172.29.*.*",
    "172.30.*.*",
    "172.31.*.*",
  ],
};

export default nextConfig;
