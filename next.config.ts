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
  async headers() {
    return [
      {
        // Apply to every path.
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
