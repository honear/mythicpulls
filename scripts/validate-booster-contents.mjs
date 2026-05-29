#!/usr/bin/env node
// Validates every data/booster-contents/*.json against the recipe schema
// used by lib/booster-config.ts + lib/booster-loader.ts. Catches the
// mistakes hand- or batch-authored recipe files tend to have: malformed
// JSON, slot counts that don't add up to cardCount, references to filters
// that don't exist in data/filters.json, and non-positive weights.
//
// Usage: node scripts/validate-booster-contents.mjs [file ...]
//   No args → validates the whole data/booster-contents directory.
// Exit code 1 if any errors are found (0 = clean, warnings don't fail).

import { promises as fs } from "fs";
import path from "path";

const ROOT = process.cwd();
const CONTENTS_DIR = path.join(ROOT, "data", "booster-contents");
const FILTERS_FILE = path.join(ROOT, "data", "filters.json");

const PACK_TYPES = ["play", "draft", "collector", "jumpstart"];
const RARITIES = ["common", "uncommon", "rare", "mythic"];
const SLOT_KEYS = new Set(["label", "count", "foil", "basicLand", "token", "outcomes"]);
const OUTCOME_KEYS = new Set(["weight", "set", "rarity", "filter", "foil", "label"]);

async function loadJson(file) {
  const txt = await fs.readFile(file, "utf-8");
  return JSON.parse(txt);
}

async function main() {
  const filters = await loadJson(FILTERS_FILE);
  const filterNames = new Set(Object.keys(filters).filter((k) => !k.startsWith("_")));

  let files = process.argv.slice(2);
  if (files.length === 0) {
    const entries = await fs.readdir(CONTENTS_DIR);
    files = entries
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(CONTENTS_DIR, f));
  }

  let errorCount = 0;
  let warnCount = 0;
  let fileCount = 0;

  for (const file of files.sort()) {
    const name = path.basename(file);
    const errs = [];
    const warns = [];

    let data;
    try {
      data = await loadJson(file);
    } catch (e) {
      console.log(`✗ ${name}: invalid JSON — ${e.message}`);
      errorCount++;
      continue;
    }
    fileCount++;

    if (data.costUsd) {
      for (const [pt, v] of Object.entries(data.costUsd)) {
        if (!PACK_TYPES.includes(pt)) errs.push(`costUsd has unknown pack type "${pt}"`);
        else if (typeof v !== "number" || v < 0) errs.push(`costUsd.${pt} must be a non-negative number`);
      }
    }

    for (const pt of PACK_TYPES) {
      const pack = data[pt];
      if (pack == null) continue;
      if (typeof pack.cardCount !== "number") errs.push(`${pt}.cardCount must be a number`);
      if (!Array.isArray(pack.slots) || pack.slots.length === 0) {
        errs.push(`${pt}.slots must be a non-empty array`);
        continue;
      }

      let slotSum = 0;
      pack.slots.forEach((slot, i) => {
        const where = `${pt}.slots[${i}]${slot.label ? ` "${slot.label}"` : ""}`;
        for (const k of Object.keys(slot)) {
          if (!SLOT_KEYS.has(k)) warns.push(`${where}: unknown slot key "${k}"`);
        }
        if (typeof slot.label !== "string") errs.push(`${where}: missing string label`);
        const count = slot.count ?? 1;
        if (typeof count !== "number" || count < 1) errs.push(`${where}: count must be >= 1`);
        slotSum += count;

        if (!Array.isArray(slot.outcomes) || slot.outcomes.length === 0) {
          errs.push(`${where}: outcomes must be a non-empty array`);
          return;
        }
        slot.outcomes.forEach((o, j) => {
          const ow = `${where} outcome[${j}]`;
          for (const k of Object.keys(o)) {
            if (!OUTCOME_KEYS.has(k)) warns.push(`${ow}: unknown outcome key "${k}"`);
          }
          if (typeof o.weight !== "number" || o.weight <= 0) errs.push(`${ow}: weight must be > 0`);
          if (o.rarity != null && !RARITIES.includes(o.rarity)) errs.push(`${ow}: bad rarity "${o.rarity}"`);
          if (o.filter != null && !filterNames.has(o.filter)) errs.push(`${ow}: filter "${o.filter}" not in filters.json`);
          if (o.set != null && typeof o.set !== "string") errs.push(`${ow}: set must be a string`);
        });
      });

      if (typeof pack.cardCount === "number" && slotSum !== pack.cardCount) {
        warns.push(`${pt}: slot counts sum to ${slotSum} but cardCount is ${pack.cardCount}`);
      }
    }

    if (errs.length === 0 && warns.length === 0) {
      console.log(`✓ ${name}`);
    } else {
      const tag = errs.length ? "✗" : "⚠";
      console.log(`${tag} ${name}`);
      for (const e of errs) console.log(`    ERROR: ${e}`);
      for (const w of warns) console.log(`    warn:  ${w}`);
      errorCount += errs.length;
      warnCount += warns.length;
    }
  }

  console.log(`\n${fileCount} files · ${errorCount} errors · ${warnCount} warnings`);
  process.exit(errorCount > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
