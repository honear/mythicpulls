// Server-only: this module uses node:fs. It is only imported from server
// components (notably app/sets/[code]/page.tsx). Importing from a client
// component will produce a bundler error on the `fs` import — which is the
// actual guard rail; we don't bother with the optional `server-only`
// package since the fs import already accomplishes the same outcome.
import { promises as fs } from "fs";
import path from "path";
import type { FilterPredicate } from "./booster-filters";
import type {
  BoosterContents,
  PackContent,
  PackType,
} from "./booster-config";
// Mana Pool live market prices — the primary source of pack pricing.
// When Mana Pool doesn't carry a (set, packType), we fall back to the
// hand-set `costUsd` block on the relevant `data/booster-contents/*.json`
// — set-specific first, then default. Only when BOTH the live lookup
// and the costUsd fallback are missing does the UI render "Not available".
import { getManaPoolSpendPrice } from "./manapool";

/**
 * Server-only fs-based loader. Importing this from a client component
 * fails the build via "server-only". Pair with lib/booster-config.ts for
 * the client-safe types + helpers.
 *
 * Lookup model — there is no per-set config indirection any more. To
 * customize a set's pack contents, drop a file at
 * `data/booster-contents/<setCode>.json` defining whichever pack types
 * differ from the global default. Pack types not present in that file
 * fall through to `data/booster-contents/default.json`. Missing file →
 * everything comes from default.
 */

const DATA_ROOT = path.join(process.cwd(), "data");
const CONTENTS_DIR = path.join(DATA_ROOT, "booster-contents");
const FILTERS_FILE = path.join(DATA_ROOT, "filters.json");

const contentCache = new Map<string, BoosterContents | null>();
let filtersCache: Record<string, FilterPredicate> | null = null;

async function readJsonOrNull<T>(filepath: string): Promise<T | null> {
  try {
    const txt = await fs.readFile(filepath, "utf-8");
    return JSON.parse(txt) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export async function loadFilters(): Promise<Record<string, FilterPredicate>> {
  if (filtersCache) return filtersCache;
  const data = await readJsonOrNull<Record<string, FilterPredicate>>(FILTERS_FILE);
  filtersCache = data ?? {};
  return filtersCache;
}

/**
 * Load `data/booster-contents/<name>.json`. Caches the parse result —
 * including a `null` for files that don't exist — so repeat lookups
 * during a single request don't re-hit the disk. The cache is process-
 * wide, which is fine because the files are bundled into the build and
 * never mutate at runtime.
 */
export async function loadBoosterContents(name: string): Promise<BoosterContents | null> {
  const key = name.toLowerCase();
  if (contentCache.has(key)) return contentCache.get(key) ?? null;
  const file = path.join(CONTENTS_DIR, `${key}.json`);
  const data = await readJsonOrNull<BoosterContents>(file);
  contentCache.set(key, data);
  return data;
}

export interface ResolvedRecipe {
  /** The actual content object the engine will use to roll a pack. */
  content: PackContent;
  /** Which JSON name produced it (for debugging / dev log). */
  source: string;
  /** Resolved pack price in USD. Resolution:
   *    1. Mana Pool live market price for this (set, packType)
   *    2. `data/booster-contents/<setCode>.json::costUsd[packType]`
   *    3. `data/booster-contents/default.json::costUsd[packType]`
   *    4. undefined — renders as "Not available" in the UI. */
  costUsd: number | undefined;
}

/**
 * Resolve the booster content + cost for a (setCode, packType) pair.
 *
 *   1. Try `data/booster-contents/<setCode>.json`. If it defines this
 *      pack type, use it ("source": setCode).
 *   2. Otherwise fall through to `data/booster-contents/default.json`
 *      ("source": "default"). Each set-specific file is a partial
 *      override — undefined pack types automatically inherit default.
 *   3. Cost resolution chain:
 *        a. Mana Pool live market price for (setCode, packType).
 *        b. Set-specific `costUsd[packType]` (from
 *           `data/booster-contents/<setCode>.json`).
 *        c. Default `costUsd[packType]` (from
 *           `data/booster-contents/default.json`).
 *        d. undefined → UI renders "Not available".
 */
export async function resolveRecipe(
  setCode: string,
  packType: PackType,
): Promise<ResolvedRecipe | null> {
  const code = setCode.toLowerCase();
  // Parallel load: most sets will only have a default hit, but we pay
  // the same time either way and avoid a second await round-trip when
  // a set-specific file does exist.
  const [setSpecific, defaultContent] = await Promise.all([
    loadBoosterContents(code),
    loadBoosterContents("default"),
  ]);

  const content = setSpecific?.[packType] ?? defaultContent?.[packType] ?? null;
  if (!content) return null;

  // Cost chain: Mana Pool live → set-specific costUsd → default costUsd.
  // Undefined falls through to the UI's "Not available" rendering. The
  // MSRP fallbacks let the MoneyStrip's "Spent" counter still tally a
  // reasonable number for sets Mana Pool doesn't currently stock.
  const livePrice = getManaPoolSpendPrice(code, packType);
  const costUsd =
    livePrice ??
    setSpecific?.costUsd?.[packType] ??
    defaultContent?.costUsd?.[packType] ??
    undefined;

  return {
    content,
    source: setSpecific?.[packType] ? code : "default",
    costUsd,
  };
}

/**
 * Which pack types does this set support? Combines two signals:
 *   - The date-based heuristic (play boosters only exist 2024-02-01+;
 *     collector boosters only 2019-10-01+; draft is universal).
 *   - The set-specific content file, if present, can extend the list
 *     (e.g., a pre-2024 set that explicitly defines a play recipe).
 *
 * No `data/sets/<code>.json` indirection — pack availability now reads
 * directly off the content file's defined pack types plus the date
 * heuristic.
 */
export async function packsAvailableForSet(
  setCode: string,
  releasedAt: string | undefined,
): Promise<PackType[]> {
  const released = releasedAt ?? "";
  const out = new Set<PackType>();

  // Date-based heuristic: matches the legacy packsAvailableFor in
  // lib/pack-rules.ts so behaviour is identical for sets without a
  // dedicated content file.
  if (released >= "2024-02-01") out.add("play");
  out.add("draft");
  if (released >= "2019-10-01") out.add("collector");

  // If the set has its own content file, anything IT explicitly defines
  // is available even if the date heuristic wouldn't have included it.
  // (Use case: a one-off Universes-Beyond set that ships a custom Play
  // Booster despite a pre-2024 release-equivalent code.)
  const setSpecific = await loadBoosterContents(setCode.toLowerCase());
  if (setSpecific) {
    if (setSpecific.play) out.add("play");
    if (setSpecific.draft) out.add("draft");
    if (setSpecific.collector) out.add("collector");
  }

  // Preserve a stable display order — matches PACK_ORDER from pack-rules.
  const order: PackType[] = ["play", "draft", "collector"];
  return order.filter((t) => out.has(t));
}
