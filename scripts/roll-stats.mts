/**
 * Statistical sanity-roller for booster recipes. Opens N packs of a given
 * (set, packType) through the REAL engine (lib/pack-open + booster-loader
 * + filters) against the pre-baked pools and prints slot/label/rarity
 * tallies vs expectation. Dev tool only — not shipped.
 *
 *   npx tsx scripts/roll-stats.mts msh play 2000
 *   npx tsx scripts/roll-stats.mts msh collector 1000
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { openPack } from "../lib/pack-open";
import { collectReferencedSets } from "../lib/booster-config";
import type { PackContent } from "../lib/booster-config";
import type { ScryfallCard } from "../lib/scryfall";
import type { FilterPredicate } from "../lib/booster-filters";

const [, , setCode = "msh", packType = "play", nStr = "2000"] = process.argv;
const N = parseInt(nStr, 10);

function loadPool(code: string): ScryfallCard[] {
  try {
    const gz = readFileSync(join(process.cwd(), "data", "set-cards", `${code.toLowerCase()}.json.gz`));
    return JSON.parse(gunzipSync(gz).toString("utf8"));
  } catch {
    return [];
  }
}

const contents = JSON.parse(
  readFileSync(join(process.cwd(), "data", "booster-contents", `${setCode.toLowerCase()}.json`), "utf8"),
);
const recipe: PackContent = contents[packType];
if (!recipe) {
  console.error(`No '${packType}' recipe in ${setCode}.json`);
  process.exit(1);
}
const filters: Record<string, FilterPredicate> = JSON.parse(
  readFileSync(join(process.cwd(), "data", "filters.json"), "utf8"),
);

// Assemble the multi-set pool the same way the route layer does.
const pool: Record<string, ScryfallCard[]> = {};
for (const ref of collectReferencedSets(recipe, setCode)) {
  pool[ref.toLowerCase()] = loadPool(ref);
}
const tokenCode = `t${setCode.toLowerCase()}`;
if (!pool[tokenCode]) pool[tokenCode] = loadPool(tokenCode);

console.log(
  "pool sizes:",
  Object.entries(pool).map(([k, v]) => `${k}:${v.length}`).join("  "),
);

const slotLabelTally: Record<string, number> = {};
const rarityTally: Record<string, number> = {};
const setTally: Record<string, number> = {};
const outcomeLabelTally: Record<string, number> = {};
let foilCount = 0;
let totalCards = 0;
const cardCounts: Record<number, number> = {};

for (let i = 0; i < N; i++) {
  const pulls = openPack(recipe, pool, setCode, filters);
  cardCounts[pulls.length] = (cardCounts[pulls.length] ?? 0) + 1;
  for (const p of pulls) {
    totalCards++;
    slotLabelTally[p.slotLabel] = (slotLabelTally[p.slotLabel] ?? 0) + 1;
    rarityTally[p.card.rarity] = (rarityTally[p.card.rarity] ?? 0) + 1;
    setTally[p.card.set] = (setTally[p.card.set] ?? 0) + 1;
    if (p.foil) foilCount++;
    // PulledCard may expose the matched outcome's label via slotLabel
    // already; outcome labels like "Scene Card" surface there when set.
  }
}

console.log(`\n=== ${N} × ${setCode}/${packType} ===`);
console.log("cards per pack:", JSON.stringify(cardCounts));
console.log("\nper-pack averages by slot label:");
for (const [k, v] of Object.entries(slotLabelTally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${(v / N).toFixed(3).padStart(8)}  ${k}`);
}
console.log("\nper-pack averages by rarity:");
for (const [k, v] of Object.entries(rarityTally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${(v / N).toFixed(3).padStart(8)}  ${k}`);
}
console.log("\nper-pack averages by source set:");
for (const [k, v] of Object.entries(setTally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${(v / N).toFixed(3).padStart(8)}  ${k}`);
}
console.log(`\nfoils per pack: ${(foilCount / N).toFixed(3)}`);
void outcomeLabelTally;
