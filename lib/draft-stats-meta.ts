/**
 * Lightweight metadata about which sets we ship 17Lands aggregates for.
 *
 * Separate from `lib/draft-stats.ts` (which imports the multi-MB JSON
 * files) so that components which only need a yes/no badge — like the
 * SetGrid on the home / sealed / draft pickers — don't end up bundling
 * the full card aggregates for every set. This keeps the home-page
 * client bundle small while the /draft route can still import the
 * heavy loader at will.
 *
 * Adding a new set: include its lowercase code here AND in
 * `lib/draft-stats.ts`'s STATS_BY_SET map.
 */

const SETS_WITH_DRAFT_STATS = new Set<string>([
  "sos",
  "tla",
  "eoe",
  "fin",
  "tdm",
  "dft",
  "pio",
  "fdn",
  "dsk",
  "blb",
  "mh3",
  "otj",
  "mkm",
  "lci",
  "woe",
  "ltr",
  "mat",
  "mom",
  "one",
  "bro",
  "dmu",
  "hbg",
  "snc",
  "neo",
  "vow",
  "mid",
  "afr",
  "stx",
  "khm",
  "klr",
  "znr",
  "akr",
  "m21",
  "iko",
  "thb",
  "eld",
  "m20",
  "war",
  "rna",
]);

export function setHasDraftStats(setCode: string | undefined): boolean {
  if (!setCode) return false;
  return SETS_WITH_DRAFT_STATS.has(setCode.toLowerCase());
}
