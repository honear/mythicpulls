import { ImageResponse } from "next/og";

/**
 * Social-share preview image. Next.js's App Router auto-discovers this
 * file and emits the corresponding <meta property="og:image"> + sizing
 * tags into the document head, so every link shared on Slack, iMessage,
 * Discord, Twitter, etc. picks it up automatically.
 *
 * It's a generated placeholder — pure JSX rendered to a 1200×630 PNG
 * by `next/og` at build time, so it stays in sync with the brand
 * colours and the three-tower Logomark without anyone touching a
 * design tool. When you want to swap in a custom hand-designed image:
 *
 *   1. Drop a static file at `app/opengraph-image.png` (or .jpg/.gif).
 *   2. Delete this `app/opengraph-image.tsx`.
 *
 * Next prefers static image files over the generator when both exist.
 * The static file route is the easy "drag-drop replacement" path
 * mentioned in the brief — see also `node_modules/next/dist/docs/
 * 01-app/03-api-reference/03-file-conventions/01-metadata/
 * opengraph-image.md` for the file-naming conventions.
 *
 * Image is 1200×630 — the canonical Open Graph aspect ratio that
 * Facebook, LinkedIn, Slack, and iMessage all render as a wide banner.
 * Twitter / X's `summary_large_image` card uses the same dimensions.
 */

export const alt =
  "Three Tree City — open Magic packs, run sealed builds, and practice drafts in your browser.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Static rendering — no request-time APIs, so Next caches this PNG at
// build time and serves it directly. (See generator docs: cached unless
// the function uses request-time APIs or dynamic config.)
export const dynamic = "force-static";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "80px",
          // Same purple journey used in the Logomark gradient and the
          // page background, so the social card visually matches the
          // site you land on after clicking.
          background:
            "linear-gradient(135deg, #0d0820 0%, #1a0f3d 35%, #3a1099 70%, #4f17d4 100%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        {/* Soft radial glow behind the wordmark — gives the flat
            gradient some depth without competing with the text. */}
        <div
          style={{
            position: "absolute",
            top: "-200px",
            right: "-200px",
            width: "800px",
            height: "800px",
            background:
              "radial-gradient(circle, rgba(164,132,215,0.35) 0%, rgba(164,132,215,0) 60%)",
            display: "flex",
          }}
        />

        {/* Top row — castle logomark + brand wordmark. The castle SVG is
            inlined as JSX so Satori (the renderer under next/og) can
            rasterize it without a separate asset fetch. Path data is
            verbatim from `app/_components/SiteHeader.tsx::Logomark`. */}
        <div style={{ display: "flex", alignItems: "center", gap: "32px" }}>
          <svg
            width="120"
            height="120"
            viewBox="0 0 32 32"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <linearGradient id="og-mark" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#cbb3f0" />
                <stop offset="55%" stopColor="#b48bff" />
                <stop offset="100%" stopColor="#8a4dff" />
              </linearGradient>
            </defs>
            <path
              fill="url(#og-mark)"
              d="M3 28 L3 11 L5 11 L5 9 L7 9 L7 11 L9 11 L9 9 L11 9 L11 11 L11 28 Z"
            />
            <path
              fill="url(#og-mark)"
              d="M21 28 L21 11 L23 11 L23 9 L25 9 L25 11 L27 11 L27 9 L29 9 L29 11 L29 28 Z"
            />
            <path
              fill="url(#og-mark)"
              fillRule="evenodd"
              d="M11 28 L11 5 L13 5 L13 3 L15 3 L15 5 L17 5 L17 3 L19 3 L19 5 L21 5 L21 28 Z M14 28 L14 22 A2 2 0 0 1 18 22 L18 28 Z"
            />
          </svg>
          <div
            style={{
              fontSize: "44px",
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: "rgba(255,255,255,0.95)",
              display: "flex",
            }}
          >
            Three Tree City
          </div>
        </div>

        {/* Headline — the actual selling line. Kept short so it stays
            readable when iMessage etc. crop the image down to 600px
            wide thumbnails. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "24px",
            maxWidth: "900px",
          }}
        >
          <div
            style={{
              fontSize: "92px",
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              color: "#ffffff",
              display: "flex",
            }}
          >
            Open Magic packs.
          </div>
          <div
            style={{
              fontSize: "92px",
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              color: "rgba(255,255,255,0.65)",
              display: "flex",
            }}
          >
            Draft. Sealed. Free.
          </div>
        </div>

        {/* Footer row — small attributions / category tag. Aligned to
            the bottom-left so it never overlaps the wordmark. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "20px",
            fontSize: "24px",
            color: "rgba(255,255,255,0.55)",
          }}
        >
          <div
            style={{
              display: "flex",
              padding: "8px 20px",
              borderRadius: "999px",
              background: "rgba(255,255,255,0.12)",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "rgba(255,255,255,0.85)",
              fontSize: "22px",
              fontWeight: 500,
            }}
          >
            Fan project · Powered by Scryfall &amp; 17Lands
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
