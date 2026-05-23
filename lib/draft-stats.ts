/**
 * 17Lands draft-aggregate lookups for the bot scorer.
 *
 * Heavy companion to `lib/draft-stats-meta.ts`. This module imports every
 * per-set JSON in `data/draft-stats/<code>.json` and exposes them via
 * `getDraftStats(code)` + `getCardStat(code, name)`. Only routes that
 * need card-level lookups (the draft engine in `app/draft/`) should
 * import from here — components that only need a yes/no presence check
 * (SetGrid badge, etc.) should import from `draft-stats-meta` to avoid
 * bundling the ~5 MB of card aggregates.
 *
 * Per-set JSON is produced by `scripts/fetch-17lands.mjs` from 17Lands'
 * public card_ratings endpoint. Each file holds: name, rarity, color,
 * ATA, ALSA, pick counts, and (when sample size ≥ 200 games) GIH WR
 * and friends.
 */

import sosStats from "../data/draft-stats/sos.json";
import tlaStats from "../data/draft-stats/tla.json";
import eoeStats from "../data/draft-stats/eoe.json";
import finStats from "../data/draft-stats/fin.json";
import tdmStats from "../data/draft-stats/tdm.json";
import dftStats from "../data/draft-stats/dft.json";
import pioStats from "../data/draft-stats/pio.json";
import fdnStats from "../data/draft-stats/fdn.json";
import dskStats from "../data/draft-stats/dsk.json";
import blbStats from "../data/draft-stats/blb.json";
import mh3Stats from "../data/draft-stats/mh3.json";
import otjStats from "../data/draft-stats/otj.json";
import mkmStats from "../data/draft-stats/mkm.json";
import lciStats from "../data/draft-stats/lci.json";
import woeStats from "../data/draft-stats/woe.json";
import ltrStats from "../data/draft-stats/ltr.json";
import matStats from "../data/draft-stats/mat.json";
import momStats from "../data/draft-stats/mom.json";
import oneStats from "../data/draft-stats/one.json";
import broStats from "../data/draft-stats/bro.json";
import dmuStats from "../data/draft-stats/dmu.json";
import hbgStats from "../data/draft-stats/hbg.json";
import sncStats from "../data/draft-stats/snc.json";
import neoStats from "../data/draft-stats/neo.json";
import vowStats from "../data/draft-stats/vow.json";
import midStats from "../data/draft-stats/mid.json";
import afrStats from "../data/draft-stats/afr.json";
import stxStats from "../data/draft-stats/stx.json";
import khmStats from "../data/draft-stats/khm.json";
import klrStats from "../data/draft-stats/klr.json";
import znrStats from "../data/draft-stats/znr.json";
import akrStats from "../data/draft-stats/akr.json";
import m21Stats from "../data/draft-stats/m21.json";
import ikoStats from "../data/draft-stats/iko.json";
import thbStats from "../data/draft-stats/thb.json";
import eldStats from "../data/draft-stats/eld.json";
import m20Stats from "../data/draft-stats/m20.json";
import warStats from "../data/draft-stats/war.json";
import rnaStats from "../data/draft-stats/rna.json";

export interface DraftCardStat {
  name: string;
  color?: string;
  rarity?: string;
  /** Average pick number (lower = more desirable). */
  ata?: number;
  /** Average last-seen position. */
  alsa?: number;
  /** Games-in-hand win rate, 0..1. Dropped when sample size is too small. */
  gihWr?: number;
  /** Opening-hand win rate. */
  ohWr?: number;
  /** Improvement-when-drawn (gih_wr − never_drawn_wr). */
  iwd?: number;
  pickCount?: number;
  seenCount?: number;
  playRate?: number;
  /** Games in hand — the sample size behind gihWr / ohWr / iwd. */
  gihGames?: number;
}

export interface DraftStats {
  set: string;
  format: string;
  window: { start: string; end: string };
  fetchedAt: string;
  cardCount: number;
  cardsWithWinrate: number;
  minSampleForWinrate: number;
  cards: Record<string, DraftCardStat>;
}

const STATS_BY_SET: Record<string, DraftStats> = {
  sos: sosStats as DraftStats,
  tla: tlaStats as DraftStats,
  eoe: eoeStats as DraftStats,
  fin: finStats as DraftStats,
  tdm: tdmStats as DraftStats,
  dft: dftStats as DraftStats,
  pio: pioStats as DraftStats,
  fdn: fdnStats as DraftStats,
  dsk: dskStats as DraftStats,
  blb: blbStats as DraftStats,
  mh3: mh3Stats as DraftStats,
  otj: otjStats as DraftStats,
  mkm: mkmStats as DraftStats,
  lci: lciStats as DraftStats,
  woe: woeStats as DraftStats,
  ltr: ltrStats as DraftStats,
  mat: matStats as DraftStats,
  mom: momStats as DraftStats,
  one: oneStats as DraftStats,
  bro: broStats as DraftStats,
  dmu: dmuStats as DraftStats,
  hbg: hbgStats as DraftStats,
  snc: sncStats as DraftStats,
  neo: neoStats as DraftStats,
  vow: vowStats as DraftStats,
  mid: midStats as DraftStats,
  afr: afrStats as DraftStats,
  stx: stxStats as DraftStats,
  khm: khmStats as DraftStats,
  klr: klrStats as DraftStats,
  znr: znrStats as DraftStats,
  akr: akrStats as DraftStats,
  m21: m21Stats as DraftStats,
  iko: ikoStats as DraftStats,
  thb: thbStats as DraftStats,
  eld: eldStats as DraftStats,
  m20: m20Stats as DraftStats,
  war: warStats as DraftStats,
  rna: rnaStats as DraftStats,
};

export function getDraftStats(setCode: string | undefined): DraftStats | null {
  if (!setCode) return null;
  return STATS_BY_SET[setCode.toLowerCase()] ?? null;
}

/**
 * Look up a single card's aggregate. 17Lands stores DFC / split cards
 * under their *front-face* name (e.g. "Burrog Banemaker") while
 * Scryfall's `name` field uses the joined form ("Burrog Banemaker //
 * Burrog Barrage"). We try the joined name first, then the part before
 * " // ", then fall back to scanning lowercased keys.
 */
export function getCardStat(
  setCode: string | undefined,
  cardName: string,
): DraftCardStat | null {
  const stats = getDraftStats(setCode);
  if (!stats) return null;
  if (stats.cards[cardName]) return stats.cards[cardName];
  const firstFace = cardName.split(" // ")[0];
  if (firstFace && firstFace !== cardName && stats.cards[firstFace]) {
    return stats.cards[firstFace];
  }
  // Last resort: case-insensitive scan. O(n) but only triggered on
  // a real miss — the keyed lookups above cover the common path.
  const target = cardName.toLowerCase();
  for (const [k, v] of Object.entries(stats.cards)) {
    if (k.toLowerCase() === target) return v;
  }
  return null;
}
