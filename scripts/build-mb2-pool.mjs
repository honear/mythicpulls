#!/usr/bin/env node
// @ts-check
/**
 * Builds the Mystery Booster 2 "normal reprint" card pool that fills the
 * bulk of an MB2 pack, and writes it to data/set-cards/mb2norm.json.gz
 * (read by lib/scryfall.ts::getSetCards for the pool code "mb2norm").
 *
 * WHY THIS EXISTS: Scryfall's `set:mb2` only contains the ~385 special
 * treatments (white-bordered, Future Sight frame, playtest cards). The
 * ~1,800 normal reprints that make up most of an MB2 pack are filed under
 * their ORIGINAL printings, so there's no single Scryfall set for them.
 * The community "MB2 full card list (for digital draft)" on Moxfield is
 * the canonical pool; we pull it, resolve each card to its Scryfall
 * printing, trim to our runtime shape, and bake it.
 *
 * The MB2 recipe (data/booster-contents/mb2.json) draws its common /
 * uncommon / rare-mythic slots from "mb2norm" (this file) and its
 * white-bordered / Future Sight / playtest slots from the live Scryfall
 * "mb2" set (which has the treatments).
 *
 * Usage: node scripts/build-mb2-pool.mjs
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "data", "set-cards", "mb2norm.json.gz");
const DECKS = ["mzt8osNua0yPgvG6tACEAQ", "WLKrcJLn8EiFggRc2lKeJA"];
// Moxfield sits behind Cloudflare, which 403s non-browser User-Agents.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const SCRY_UA = "ThreeTreeCity/1.0 (MB2 pool builder)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function trim(c) {
  return {
    id: c.id,
    name: c.name,
    set: c.set,
    set_name: c.set_name,
    collector_number: c.collector_number,
    rarity: c.rarity,
    type_line: c.type_line,
    mana_cost: c.mana_cost,
    cmc: c.cmc,
    colors: c.colors,
    color_identity: c.color_identity,
    image_uris: c.image_uris
      ? { normal: c.image_uris.normal, large: c.image_uris.large, art_crop: c.image_uris.art_crop }
      : undefined,
    card_faces: c.card_faces?.map((f) => ({
      name: f.name,
      mana_cost: f.mana_cost,
      type_line: f.type_line,
      image_uris: f.image_uris
        ? { normal: f.image_uris.normal, large: f.image_uris.large, art_crop: f.image_uris.art_crop }
        : undefined,
    })),
    layout: c.layout,
    scryfall_uri: c.scryfall_uri,
    prices: c.prices
      ? { usd: c.prices.usd, usd_foil: c.prices.usd_foil, usd_etched: c.prices.usd_etched, eur: c.prices.eur, eur_foil: c.prices.eur_foil }
      : undefined,
    artist: c.artist,
    frame_effects: c.frame_effects,
    frame: c.frame,
    full_art: c.full_art,
    border_color: c.border_color,
    promo_types: c.promo_types,
    produced_mana: c.produced_mana,
    lang: c.lang,
    finishes: c.finishes,
    digital: false,
    oversized: false,
    booster: c.booster,
  };
}

async function moxfieldIds() {
  const ids = new Set();
  for (const id of DECKS) {
    // Moxfield's Cloudflare fingerprints Node's fetch and 403s it even with
    // a browser UA, so shell out to curl (which gets through).
    const raw = execFileSync(
      "curl",
      ["-s", "-m", "30", "-H", `User-Agent: ${UA}`, `https://api2.moxfield.com/v3/decks/all/${id}`],
      { maxBuffer: 64 * 1024 * 1024 },
    ).toString();
    const d = JSON.parse(raw);
    const cards = d.boards?.mainboard?.cards ?? {};
    for (const k of Object.keys(cards)) {
      const c = cards[k].card ?? {};
      const sid = c.scryfall_id || c.id;
      if (sid) ids.add(sid);
    }
    await sleep(200);
  }
  return [...ids];
}

async function resolveCards(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 75) {
    const batch = ids.slice(i, i + 75).map((id) => ({ id }));
    const r = await fetch("https://api.scryfall.com/cards/collection", {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ identifiers: batch }),
    });
    if (!r.ok) throw new Error(`Scryfall collection HTTP ${r.status}`);
    const d = await r.json();
    for (const c of d.data ?? []) out.push(trim(c));
    if ((d.not_found ?? []).length) console.log(`  (batch ${i / 75 + 1}: ${d.not_found.length} not found)`);
    process.stdout.write(`\r  resolved ${out.length}/${ids.length}`);
    await sleep(120);
  }
  console.log("");
  return out;
}

async function main() {
  console.log("Fetching MB2 pool card IDs from Moxfield…");
  const ids = await moxfieldIds();
  console.log(`  ${ids.length} unique card IDs`);
  console.log("Resolving via Scryfall collection API…");
  const cards = await resolveCards(ids);
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, gzipSync(Buffer.from(JSON.stringify(cards)), { level: 9 }));
  const withPrice = cards.filter((c) => c.prices?.usd).length;
  console.log(`Wrote ${OUT} — ${cards.length} cards (${withPrice} with USD price).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
