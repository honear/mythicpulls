/**
 * Recipe accuracy auditor. For every data/booster-contents/<set>.json and
 * every slot outcome in it, mirrors the engine's candidatesFor logic
 * (lib/pack-open.ts) against the pre-baked pools and reports:
 *
 *   • outcomes whose candidate pool is EMPTY — the engine silently
 *     re-rolls past these, so the printed odds drift from the recipe's
 *     intent (the higher the weight, the worse the distortion);
 *   • unknown filter names (typo'd outcome.filter);
 *   • missing pools for referenced sets;
 *   • cardCount vs sum-of-slot-counts mismatches;
 *   • slot weight sums far from 100 when the file's _doc cites article
 *     percentages (informational — weights normalize, but a sum of 57
 *     usually means a transcription slip).
 *
 *   npx tsx scripts/audit-recipes.mts            # audit everything
 *   npx tsx scripts/audit-recipes.mts msh spm    # specific sets
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import {
  matchesFilter,
  resolveFilter,
  predicateMentionsLang,
  predicateMentionsLand,
  predicateIsAltArtIntent,
  type FilterPredicate,
} from "../lib/booster-filters";
import { resolveSetSentinel } from "../lib/booster-config";
import type { ScryfallCard } from "../lib/scryfall";

const ROOT = process.cwd();
const CONTENTS = join(ROOT, "data", "booster-contents");
const POOLS = join(ROOT, "data", "set-cards");
const filters: Record<string, FilterPredicate> = JSON.parse(
  readFileSync(join(ROOT, "data", "filters.json"), "utf8"),
);

const poolCache = new Map<string, ScryfallCard[]>();
function loadPool(code: string): ScryfallCard[] {
  const key = code.toLowerCase();
  if (poolCache.has(key)) return poolCache.get(key)!;
  const file = join(POOLS, `${key}.json.gz`);
  let cards: ScryfallCard[] = [];
  if (existsSync(file)) {
    cards = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8"));
  }
  poolCache.set(key, cards);
  return cards;
}

/** Mirror of candidatesFor minus the excludedIds dedup (irrelevant for
 *  emptiness checks). Keep in sync with lib/pack-open.ts. */
function candidateCount(
  outcome: { set?: string; rarity?: string; filter?: string },
  ownSet: string,
  isLandSlot: boolean,
): { count: number; poolMissing: boolean; badFilter: boolean } {
  const target = resolveSetSentinel(outcome.set, ownSet) ?? ownSet.toLowerCase();
  const setCards = loadPool(target);
  if (!setCards.length) return { count: 0, poolMissing: true, badFilter: false };

  let out = setCards;
  if (outcome.rarity) out = out.filter((c) => c.rarity === outcome.rarity);

  let badFilter = false;
  let predicate: FilterPredicate | undefined;
  if (outcome.filter) {
    predicate = filters[outcome.filter];
    if (!predicate) badFilter = true;
  }
  if (predicate) out = out.filter((c) => matchesFilter(c, predicate));

  if (!isLandSlot && !predicateMentionsLand(predicate)) {
    const basicLand = resolveFilter(filters, "basic_land");
    if (basicLand) out = out.filter((c) => !matchesFilter(c, basicLand));
  }
  if (!predicateMentionsLang(predicate)) {
    const en = out.filter((c) => !c.lang || c.lang.toLowerCase() === "en");
    if (en.length > 0) out = en;
  }
  if (!predicateIsAltArtIntent(predicate)) {
    const regular = resolveFilter(filters, "regular_print");
    if (regular) {
      const reg = out.filter((c) => matchesFilter(c, regular));
      if (reg.length > 0) out = reg;
    }
  }
  return { count: out.length, poolMissing: false, badFilter };
}

const argSets = process.argv.slice(2).map((s) => s.toLowerCase());
const files = readdirSync(CONTENTS)
  .filter((f) => f.endsWith(".json") && f !== "default.json")
  .filter((f) => !argSets.length || argSets.includes(f.replace(".json", "")));

interface Finding {
  set: string;
  severity: "ERROR" | "WARN" | "INFO";
  msg: string;
}
const findings: Finding[] = [];
let outcomesChecked = 0;
let slotsChecked = 0;

for (const f of files) {
  const setCode = f.replace(".json", "");
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(readFileSync(join(CONTENTS, f), "utf8"));
  } catch (e) {
    findings.push({ set: setCode, severity: "ERROR", msg: `JSON parse failed: ${e}` });
    continue;
  }

  for (const packType of ["play", "draft", "collector", "jumpstart"] as const) {
    const content = doc[packType] as
      | { cardCount?: number; slots?: Array<Record<string, unknown>> }
      | undefined;
    if (!content?.slots) continue;

    // cardCount vs slot-count sum.
    const slotSum = content.slots.reduce(
      (s, slot) => s + ((slot.count as number) ?? 1),
      0,
    );
    if (content.cardCount != null && slotSum !== content.cardCount) {
      findings.push({
        set: setCode,
        severity: "WARN",
        msg: `${packType}: cardCount=${content.cardCount} but slots sum to ${slotSum}`,
      });
    }

    for (const slot of content.slots) {
      slotsChecked++;
      const outcomes = (slot.outcomes ?? []) as Array<{
        weight: number; set?: string; rarity?: string; filter?: string; label?: string; foil?: boolean;
      }>;
      const isLandSlot = !!slot.basicLand;
      const totalWeight = outcomes.reduce((s, o) => s + (o.weight ?? 0), 0);

      // Percent-looking slots that sum oddly — only flag multi-outcome
      // slots whose sum is far from 100 AND from any small-integer ratio.
      if (outcomes.length >= 3 && (totalWeight < 90 || totalWeight > 115)) {
        findings.push({
          set: setCode,
          severity: "INFO",
          msg: `${packType}/"${slot.label}": weights sum to ${totalWeight.toFixed(1)} (expected ~100 if article percentages)`,
        });
      }

      for (const o of outcomes) {
        outcomesChecked++;
        if (typeof o.weight !== "number" || o.weight <= 0) {
          findings.push({
            set: setCode,
            severity: "ERROR",
            msg: `${packType}/"${slot.label}": outcome has invalid weight ${o.weight}`,
          });
        }
        const { count, poolMissing, badFilter } = candidateCount(o, setCode, isLandSlot);
        if (badFilter) {
          findings.push({
            set: setCode,
            severity: "ERROR",
            msg: `${packType}/"${slot.label}": unknown filter "${o.filter}"`,
          });
        } else if (poolMissing) {
          findings.push({
            set: setCode,
            severity: slot.token ? "INFO" : "WARN",
            msg: `${packType}/"${slot.label}": pool missing for set "${o.set ?? setCode}"${slot.token ? " (token set — slot silently skipped)" : ""}`,
          });
        } else if (count === 0) {
          const share = totalWeight > 0 ? ((o.weight / totalWeight) * 100).toFixed(1) : "?";
          findings.push({
            set: setCode,
            severity: o.weight / totalWeight > 0.05 ? "WARN" : "INFO",
            msg: `${packType}/"${slot.label}": EMPTY outcome ${JSON.stringify({ set: o.set, rarity: o.rarity, filter: o.filter, label: o.label })} (${share}% of slot — engine re-rolls past it)`,
          });
        }
      }
    }
  }
}

const errors = findings.filter((x) => x.severity === "ERROR");
const warns = findings.filter((x) => x.severity === "WARN");
const infos = findings.filter((x) => x.severity === "INFO");

console.log(`Audited ${files.length} recipe files · ${slotsChecked} slots · ${outcomesChecked} outcomes\n`);
for (const sev of ["ERROR", "WARN", "INFO"] as const) {
  const list = findings.filter((x) => x.severity === sev);
  if (!list.length) continue;
  console.log(`=== ${sev} (${list.length}) ===`);
  for (const x of list) console.log(`  [${x.set}] ${x.msg}`);
  console.log();
}
console.log(`Summary: ${errors.length} errors, ${warns.length} warnings, ${infos.length} info`);
if (errors.length) process.exit(1);
