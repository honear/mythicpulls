#!/usr/bin/env node
// @ts-check
/**
 * Fetch per-set draft aggregates from 17Lands and write trimmed JSON
 * files into `data/draft-stats/<set>.json`. The endpoint already
 * delivers per-card aggregates (~250 KB per set), so this script does
 * not have to touch the multi-GB raw CSV dumps in /17Lands/ — we just
 * GET the public card_ratings JSON for each set listed in
 * data/draft-stats-config.json and strip the fields we won't use.
 *
 * Usage:
 *   node scripts/fetch-17lands.mjs                # fetch every set in the config
 *   node scripts/fetch-17lands.mjs SOS TLA        # only the listed set codes
 *
 * The 17Lands API expects:
 *   GET https://www.17lands.com/card_ratings/data
 *       ?expansion=<CODE>            # e.g. SOS
 *       &format=PremierDraft         # always (configurable in the config file)
 *       &start_date=YYYY-MM-DD       # required
 *       &end_date=YYYY-MM-DD         # required — defaults to today if config has null
 *
 * The response is a JSON array of card aggregates. We persist only the
 * fields the bot + UI badge actually use:
 *   name, color, rarity, ata, alsa, gih_wr, ohwr, drawn_improvement,
 *   pick_count, seen_count, play_rate
 *
 * Cards with too few samples (`ever_drawn_game_count < MIN_SAMPLE`) get
 * their win-rate fields dropped — the noise floor below ~200 games is
 * too high for a meaningful signal — but the pick/seen counts are kept
 * for ATA / pick-rate fallback.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CONFIG_PATH = join(ROOT, "data", "draft-stats-config.json");
const OUT_DIR = join(ROOT, "data", "draft-stats");

const MIN_SAMPLE = 200; // games_in_hand below this → win rates dropped

/** @typedef {{
 *   name: string;
 *   color?: string;
 *   rarity?: string;
 *   ata?: number;
 *   alsa?: number;
 *   gihWr?: number;
 *   ohWr?: number;
 *   iwd?: number;
 *   pickCount?: number;
 *   seenCount?: number;
 *   playRate?: number;
 *   gihGames?: number;
 * }} CardStat */

async function main() {
  const configRaw = await readFile(CONFIG_PATH, "utf-8");
  const config = JSON.parse(configRaw);
  const fmt = config.format ?? "PremierDraft";
  const argSets = process.argv.slice(2).map((s) => s.toUpperCase());
  const setEntries = Object.entries(config.sets).filter(([code]) =>
    argSets.length === 0 ? true : argSets.includes(code.toUpperCase()),
  );
  if (setEntries.length === 0) {
    console.error(
      `No sets matched. Args=${JSON.stringify(argSets)}, config sets=${Object.keys(config.sets).join(",")}`,
    );
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);

  for (const [code, win] of setEntries) {
    const start = /** @type {string} */ (win.start);
    const end = /** @type {string | null} */ (win.end) ?? today;
    const url = `https://www.17lands.com/card_ratings/data?expansion=${encodeURIComponent(code)}&format=${encodeURIComponent(fmt)}&start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}`;
    process.stdout.write(`[${code}] fetching ${start}…${end}\n`);
    let res;
    try {
      res = await fetch(url, {
        headers: {
          "User-Agent":
            "MythicPulls/0.1 (https://github.com/honear/mythicpulls fan project; contact: rolandonic@mac.com)",
          Accept: "application/json,text/plain,*/*",
        },
      });
    } catch (err) {
      console.error(`[${code}] fetch failed:`, err);
      continue;
    }
    if (!res.ok) {
      console.error(`[${code}] HTTP ${res.status} ${res.statusText}`);
      continue;
    }
    /** @type {Array<Record<string, unknown>>} */
    const cards = await res.json();
    if (!Array.isArray(cards)) {
      console.error(`[${code}] unexpected response shape — expected array`);
      continue;
    }

    /** @type {Record<string, CardStat>} */
    const out = {};
    let withWr = 0;
    for (const c of cards) {
      const name = String(c.name ?? "").trim();
      if (!name) continue;
      const gihGames = Number(c.ever_drawn_game_count ?? 0) || 0;
      /** @type {CardStat} */
      const entry = {
        name,
        color: typeof c.color === "string" ? c.color : undefined,
        rarity: typeof c.rarity === "string" ? c.rarity : undefined,
        ata: numOrUndef(c.avg_pick),
        alsa: numOrUndef(c.avg_seen),
        pickCount: numOrUndef(c.pick_count),
        seenCount: numOrUndef(c.seen_count),
        playRate: numOrUndef(c.play_rate),
        gihGames,
      };
      if (gihGames >= MIN_SAMPLE) {
        entry.gihWr = numOrUndef(c.ever_drawn_win_rate);
        entry.ohWr = numOrUndef(c.opening_hand_win_rate);
        entry.iwd = numOrUndef(c.drawn_improvement_win_rate);
        if (entry.gihWr != null) withWr += 1;
      }
      out[name] = entry;
    }

    const meta = {
      set: code.toUpperCase(),
      format: fmt,
      window: { start, end },
      fetchedAt: new Date().toISOString(),
      cardCount: Object.keys(out).length,
      cardsWithWinrate: withWr,
      minSampleForWinrate: MIN_SAMPLE,
    };

    const outPath = join(OUT_DIR, `${code.toLowerCase()}.json`);
    await writeFile(
      outPath,
      JSON.stringify({ ...meta, cards: out }, null, 2),
      "utf-8",
    );
    process.stdout.write(
      `[${code}] wrote ${outPath} — ${meta.cardCount} cards, ${withWr} with WR\n`,
    );
  }
}

/** @returns {number | undefined} */
function numOrUndef(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
