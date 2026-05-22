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
  SetConfig,
} from "./booster-config";

/**
 * Server-only fs-based loader. Importing this from a client component
 * fails the build via "server-only". Pair with lib/booster-config.ts for
 * the client-safe types + helpers.
 */

const DATA_ROOT = path.join(process.cwd(), "data");
const CONTENTS_DIR = path.join(DATA_ROOT, "booster-contents");
const SETS_DIR = path.join(DATA_ROOT, "sets");
const FILTERS_FILE = path.join(DATA_ROOT, "filters.json");

const contentCache = new Map<string, BoosterContents>();
const setCache = new Map<string, SetConfig | null>();
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

export async function loadBoosterContents(name: string): Promise<BoosterContents | null> {
  const key = name.toLowerCase();
  if (contentCache.has(key)) return contentCache.get(key)!;
  const file = path.join(CONTENTS_DIR, `${key}.json`);
  const data = await readJsonOrNull<BoosterContents>(file);
  if (data) contentCache.set(key, data);
  return data;
}

export async function loadSetConfig(code: string): Promise<SetConfig | null> {
  const key = code.toLowerCase();
  if (setCache.has(key)) return setCache.get(key)!;
  const file = path.join(SETS_DIR, `${key}.json`);
  const data = await readJsonOrNull<SetConfig>(file);
  setCache.set(key, data);
  return data;
}

export interface ResolvedRecipe {
  /** The actual content object the engine will use to roll a pack. */
  content: PackContent;
  /** Which JSON name produced it (for debugging / dev log). */
  source: string;
  /** Per-pack-type MSRP, if the set or the default content set one. */
  costUsd: number | undefined;
}

/**
 * Resolve the booster content + cost for a (setCode, packType) pair:
 *   1. Look up data/sets/<code>.json. If it names a content for this pack
 *      type, use it; else fall back to "default".
 *   2. Load data/booster-contents/<name>.json. If the resolved content
 *      doesn't define this pack type, fall back to default's pack type.
 *   3. Cost: set config override > resolved content's per-type cost >
 *      default content's per-type cost.
 */
export async function resolveRecipe(
  setCode: string,
  packType: PackType,
): Promise<ResolvedRecipe | null> {
  const setConfig = await loadSetConfig(setCode);
  const contentName = setConfig?.boosters?.[packType] ?? "default";

  const named = await loadBoosterContents(contentName);
  const fallback =
    contentName !== "default" ? await loadBoosterContents("default") : null;

  const content = named?.[packType] ?? fallback?.[packType] ?? null;
  if (!content) return null;

  const defaultContent = await loadBoosterContents("default");
  const defaultCostMap = (defaultContent as unknown as { costUsd?: Partial<Record<PackType, number>> })?.costUsd;
  const namedCostMap = (named as unknown as { costUsd?: Partial<Record<PackType, number>> })?.costUsd;

  const costUsd =
    setConfig?.cost?.[packType] ??
    namedCostMap?.[packType] ??
    defaultCostMap?.[packType] ??
    undefined;

  return {
    content,
    source: named?.[packType] ? contentName : "default",
    costUsd,
  };
}

/** Which pack types does this set support? Reads data/sets/<code>.json if
 *  present; otherwise falls back to the legacy date-based heuristic. */
export async function packsAvailableForSet(
  setCode: string,
  releasedAt: string | undefined,
): Promise<PackType[]> {
  const setConfig = await loadSetConfig(setCode);
  if (setConfig?.boosters) {
    return (Object.keys(setConfig.boosters) as PackType[]).filter((t) =>
      ["play", "draft", "collector"].includes(t),
    );
  }
  // Legacy heuristic — matches the original packsAvailableFor in pack-rules.
  const released = releasedAt ?? "";
  const out: PackType[] = [];
  if (released >= "2024-02-01") out.push("play");
  out.push("draft");
  if (released >= "2019-10-01") out.push("collector");
  return out;
}
