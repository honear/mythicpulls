/**
 * Serves one random Confluence board for endless mode. The daily board
 * arrives as a server-rendered prop on /confluence; this route only
 * backs the "another board" button, so the client never bundles the
 * full answer pool (~600KB, and every solution in plaintext).
 *
 * `exclude` keeps the board just played (or today's daily) from being
 * dealt again immediately.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getRandomPuzzle } from "@/lib/connections";

// Random per request — never let the CDN pin one board as "the" answer.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const exclude = params.get("exclude") ?? undefined;
  const recentOnly = params.get("recent") === "1";
  const puzzle = getRandomPuzzle(exclude, { recentOnly });
  return NextResponse.json(puzzle, {
    headers: { "Cache-Control": "no-store" },
  });
}
