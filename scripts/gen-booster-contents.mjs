#!/usr/bin/env node
// Deterministically converts the per-set facts records in
// data/_collation-facts/*.json (extracted from The Collation Project,
// lethe.xyz/mtg/collation) into booster recipe files in
// data/booster-contents/*.json, in the schema lib/booster-config.ts uses.
//
// Why a generator: the facts files are the human-auditable source of
// truth (one place to correct a reading); the era rules (when mythics /
// foils / tokens / lands exist, the rare:mythic split, how occasional
// foils fold into a common slot, and the era-default modern templates)
// live here in ONE place so every set is treated consistently.
//
// Usage: node scripts/gen-booster-contents.mjs [code ...]
//   No args → regenerate every facts file. Pass codes to scope it.
//
// Re-running is idempotent. It never touches default.json or any
// booster-contents file that has no corresponding facts file (e.g. the
// hand-authored sos.json), so bespoke recipes are safe.

import { promises as fs } from "fs";
import path from "path";

const ROOT = process.cwd();
const FACTS_DIR = path.join(ROOT, "data", "_collation-facts");
const OUT_DIR = path.join(ROOT, "data", "booster-contents");

const r2 = (n) => Math.round(n * 100) / 100;

// ---- shared slot builders -------------------------------------------------

const tokenSlot = (label = "Token") => ({
  label,
  token: true,
  outcomes: [{ weight: 1, set: "$tokens" }],
});

const landSlot = (foil = false) => ({
  label: foil ? "Foil Land" : "Land",
  basicLand: true,
  ...(foil ? { foil: true } : {}),
  outcomes: [{ weight: 1, filter: "basic_land" }],
});

const commonSlot = (count) => ({
  label: "Common",
  count,
  outcomes: [{ weight: 1, rarity: "common" }],
});

const uncommonSlot = (count) => ({
  label: "Uncommon",
  count,
  outcomes: [{ weight: 1, rarity: "uncommon" }],
});

const rareSlot = (hasMythic, label = "Rare / Mythic") => ({
  label,
  outcomes: hasMythic
    ? [{ weight: 86, rarity: "rare" }, { weight: 14, rarity: "mythic" }]
    : [{ weight: 1, rarity: "rare" }],
});

// Foil rarity distribution, normalised to the rarities the set actually
// has. Classic foil sheets skew common; mythics (when present) are rare.
function foilOutcomes(hasMythic, foil = true) {
  const base = hasMythic
    ? [
        { weight: 67, rarity: "common" },
        { weight: 20, rarity: "uncommon" },
        { weight: 10, rarity: "rare" },
        { weight: 3, rarity: "mythic" },
      ]
    : [
        { weight: 67, rarity: "common" },
        { weight: 20, rarity: "uncommon" },
        { weight: 13, rarity: "rare" },
      ];
  return base.map((o) => (foil ? { ...o, foil: true } : o));
}

const foilSlot = (hasMythic) => ({
  label: "Foil",
  foil: true,
  outcomes: foilOutcomes(hasMythic, true),
});

function wildcardSlot(hasMythic) {
  return {
    label: "Wildcard",
    outcomes: hasMythic
      ? [
          { weight: 70, rarity: "common" },
          { weight: 20, rarity: "uncommon" },
          { weight: 8, rarity: "rare" },
          { weight: 2, rarity: "mythic" },
        ]
      : [
          { weight: 70, rarity: "common" },
          { weight: 20, rarity: "uncommon" },
          { weight: 10, rarity: "rare" },
        ],
  };
}

// Parse a stated foil rate into a per-pack foil probability.
//  - "33% of boosters" → 0.33 (already per-pack)
//  - "1:67" / "1 in 67 cards" → per-card rate × cardCount → per-pack
function perPackFoilProb(oddsStr, cardCount) {
  if (!oddsStr) return null;
  const s = String(oddsStr);
  const pct = s.match(/([\d.]+)\s*%/);
  if (pct) return Math.min(0.95, Number(pct[1]) / 100);
  const m = s.match(/1\s*[:in]+\s*([\d.]+)/i);
  if (!m) return null;
  return Math.min(0.95, (1 / Number(m[1])) * cardCount);
}

// One common slot that is a foil of some rarity `p` of the time. Models the
// classic "foil replaces a common, 1:N cards" rule faithfully — the rest
// of the commons stay normal.
function commonOrFoilSlot(p, hasMythic) {
  const normalW = r2((1 - p) * 100);
  const ft = p * 100;
  const split = hasMythic
    ? [["common", 0.67], ["uncommon", 0.2], ["rare", 0.1], ["mythic", 0.03]]
    : [["common", 0.67], ["uncommon", 0.2], ["rare", 0.13]];
  return {
    label: "Common (or Foil)",
    outcomes: [
      { weight: normalW, rarity: "common" },
      ...split.map(([rarity, frac]) => ({ weight: r2(ft * frac), rarity, foil: true })),
    ],
  };
}

// ---- pack-type builders ---------------------------------------------------

function sumCounts(slots) {
  return slots.reduce((n, s) => n + (s.count ?? 1), 0);
}

// Apply per-set escape hatches captured in the facts:
//   - slotsOverride: use these hand-specified slots verbatim (bespoke packs
//     like the ELD Collector Booster that don't fit a generic builder).
//   - extraSlots: splice extra guaranteed slots (DFC, lesson, Mystical
//     Archive, guildgate, retro artifact…) in just before any trailing
//     basic-land / foil slots, then recompute cardCount.
function applyExtras(pack, f) {
  if (f.slotsOverride && f.slotsOverride.length) {
    return { cardCount: sumCounts(f.slotsOverride), tagline: f.tagline ?? pack.tagline, slots: f.slotsOverride };
  }
  if (f.extraSlots && f.extraSlots.length) {
    const slots = pack.slots.slice();
    let at = slots.length;
    while (at > 0 && (slots[at - 1].basicLand || slots[at - 1].foil)) at--;
    slots.splice(at, 0, ...f.extraSlots);
    return { cardCount: sumCounts(slots), tagline: pack.tagline, slots };
  }
  return pack;
}

function buildDraft(f, hasMythic) {
  const slots = [];
  if (f.token) slots.push(tokenSlot("Token"));

  const occasionalFoil = !f.foilGuaranteed && f.foilOdds;
  const commons = f.commons ?? 0;
  if (occasionalFoil && commons > 0) {
    const p = perPackFoilProb(f.foilOdds, f.cardCount ?? commons + 5) ?? 0;
    if (commons > 1) slots.push(commonSlot(commons - 1));
    slots.push(commonOrFoilSlot(p, hasMythic));
  } else if (commons > 0) {
    slots.push(commonSlot(commons));
  }

  if (f.uncommons) slots.push(uncommonSlot(f.uncommons));
  const rares = f.rares ?? 0;
  for (let i = 0; i < rares; i++) slots.push(rareSlot(hasMythic));
  if (f.land) slots.push(landSlot(false));
  if (f.foilGuaranteed) {
    const foils = f.foils ?? 1; // Double Masters packs guarantee two foils
    for (let i = 0; i < foils; i++) slots.push(foilSlot(hasMythic));
  }

  const cardCount = sumCounts(slots);
  const foilNote = f.foilGuaranteed
    ? `${f.foils ?? 1} guaranteed foil${(f.foils ?? 1) > 1 ? "s" : ""}`
    : f.foilOdds
      ? `foil ${f.foilOdds}`
      : "no foil";
  return {
    cardCount,
    tagline: `${commons} commons · ${f.uncommons ?? 0} uncommons · ${rares}× ${hasMythic ? "rare/mythic" : "rare"}${f.land ? " · 1 basic land" : ""} · ${foilNote}`,
    slots,
  };
}

function buildPlay(f, hasMythic) {
  const commons = f.commons ?? 7;
  const uncommons = f.uncommons ?? 3;
  const slots = [
    tokenSlot("Token / Art Card"),
    commonSlot(commons),
    uncommonSlot(uncommons),
    wildcardSlot(hasMythic),
    rareSlot(hasMythic),
    landSlot(false),
    foilSlot(hasMythic),
  ];
  return {
    cardCount: sumCounts(slots),
    tagline: `${commons + uncommons} commons/uncommons · 1 wildcard · 1 rare/mythic · 1 land · 1 foil · the modern standard`,
    slots,
  };
}

// Build a Collector Booster ONLY from the structure the page actually
// details (facts.collector). We do NOT fabricate a collector pack for sets
// whose page is silent on it — per the project decision to skip pack types
// the site doesn't specify. Built generically from the stated foil-slot
// counts; showcase treatment is reflected in the rare slot label/filter
// when the page lists one.
function buildCollector(f, hasMythic, treatments) {
  const fc = f.commons ?? 0;
  const fu = f.uncommons ?? 0;
  const fr = f.rares ?? 0;
  const hasShowcase = treatments.some((t) => /showcase|magnified|dossier|extended/i.test(t));
  const slots = [];
  if (f.token) slots.push(tokenSlot("Foil Token / Art Card"));
  if (fc > 0) slots.push({ label: "Foil Common", count: fc, foil: true, outcomes: [{ weight: 1, rarity: "common" }] });
  if (fu > 0) slots.push({ label: "Foil Uncommon", count: fu, foil: true, outcomes: [{ weight: 1, rarity: "uncommon" }] });
  for (let i = 0; i < fr; i++) {
    slots.push({
      label: hasShowcase && i === 0 ? "Showcase Rare" : "Foil Rare / Mythic",
      foil: true,
      ...(hasShowcase && i === 0 ? {} : {}),
      outcomes: hasMythic
        ? [{ weight: 80, rarity: "rare" }, { weight: 20, rarity: "mythic" }]
        : [{ weight: 1, rarity: "rare" }],
    });
  }
  if (f.land) slots.push(landSlot(true));
  return {
    cardCount: sumCounts(slots),
    tagline: `premium all-foil pack · ${fc} foil commons · ${fu} foil uncommons · ${fr} foil rare/mythic${f.land ? " · 1 foil land" : ""}`,
    slots,
  };
}

// ---- main -----------------------------------------------------------------

async function main() {
  let codes = process.argv.slice(2);
  if (codes.length === 0) {
    const entries = await fs.readdir(FACTS_DIR).catch(() => []);
    codes = entries.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  }

  let written = 0;
  let skipped = 0;
  for (const code of codes.sort()) {
    const factsPath = path.join(FACTS_DIR, `${code}.json`);
    let facts;
    try {
      facts = JSON.parse(await fs.readFile(factsPath, "utf-8"));
    } catch {
      console.log(`! ${code}: no/invalid facts file — skipped`);
      skipped++;
      continue;
    }
    if (facts.skip) {
      console.log(`- ${code}: marked skip (${facts.skipReason ?? "n/a"})`);
      skipped++;
      continue;
    }

    const comp = facts.composition ?? {};
    const hasMythic = (comp.mythic ?? 0) > 0;
    const treatments = facts.specialTreatments ?? [];
    const types = facts.packTypes ?? [];

    const recipe = {};
    const docBits = [
      `${facts.name} (${facts.code.toUpperCase()}) booster recipe.`,
      "Generated by scripts/gen-booster-contents.mjs from",
      `data/_collation-facts/${facts.code}.json (source: The Collation Project,`,
      "lethe.xyz/mtg/collation). Edit the facts file and regenerate; do not",
      "hand-edit this file unless you also remove its facts source.",
    ];
    if (comp.common != null) {
      docBits.push(
        `Set composition: ${comp.common ?? 0}C / ${comp.uncommon ?? 0}U / ${comp.rare ?? 0}R / ${comp.mythic ?? 0}M.`,
      );
    }
    if (facts.collationMethod) docBits.push(`Collation: ${facts.collationMethod}.`);
    if (!hasMythic) docBits.push("Pre-mythic era: rare slot is rare-only.");
    if (types.includes("draft") && facts.draft && !facts.draft.foilGuaranteed && facts.draft.foilOdds) {
      docBits.push(
        `Occasional foil (${facts.draft.foilOdds}) modelled by folding foil odds into one common slot.`,
      );
    }
    if (facts.authoritative) {
      docBits.push("Pack-type list is authoritative — only the types defined here are offered for this set.");
    }
    if (facts.sourceNotes) docBits.push(`Notes: ${facts.sourceNotes}`);
    recipe._doc = docBits.join(" ");

    // Emit a pack type ONLY when packTypes lists it AND its facts object is
    // present — we never fabricate a pack the page doesn't detail.
    if (types.includes("play") && facts.play) recipe.play = applyExtras(buildPlay(facts.play, hasMythic), facts.play);
    if (types.includes("draft") && facts.draft) recipe.draft = applyExtras(buildDraft(facts.draft, hasMythic), facts.draft);
    if (types.includes("collector") && facts.collector) recipe.collector = applyExtras(buildCollector(facts.collector, hasMythic, treatments), facts.collector);

    // When authoritative, the loader will offer EXACTLY the defined pack
    // types (so a set with no Collector Booster won't show one).
    if (facts.authoritative) recipe.authoritative = true;

    if (Object.keys(recipe).length <= 1) {
      console.log(`! ${code}: facts produced no pack types — skipped`);
      skipped++;
      continue;
    }

    const outPath = path.join(OUT_DIR, `${code}.json`);
    await fs.writeFile(outPath, JSON.stringify(recipe, null, 2) + "\n", "utf-8");
    console.log(`✓ ${code}: ${types.join(", ")}`);
    written++;
  }

  console.log(`\n${written} written · ${skipped} skipped`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
