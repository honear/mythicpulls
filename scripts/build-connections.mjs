#!/usr/bin/env node
// @ts-check
/**
 * Generate the puzzle pool for Confluence — the site's MTG take on a
 * NYT-Connections-style daily: 16 card names, four hidden groups of
 * four, exactly one valid solution.
 *
 * Reads the pre-baked card pools in `data/set-cards/*.json.gz` (built
 * by scripts/build-set-cards.mjs — no network calls here) and writes
 * `data/connections/puzzles.json`, which lib/connections.ts imports
 * statically. Follows the house static-data pattern: generate offline,
 * bundle at build time, zero runtime API calls.
 *
 * Usage:
 *   node scripts/build-connections.mjs            # default 120 puzzles
 *   node scripts/build-connections.mjs --count 40 # smaller pool
 *   node scripts/build-connections.mjs --seed 7   # different schedule
 *
 * Group archetypes (one of each per board, difficulty 0→3):
 *   0 yellow  hiddenWord    — every name contains a word from a theme
 *                             (numbers, weather, body parts, …). The
 *                             "read the tiles" tier — solvable without
 *                             deep MTG knowledge.
 *   1 green   creatureType  — four creatures sharing a subtype whose
 *             | cardType      names do NOT contain the type word
 *                             (Wizards; or instants, sagas, vehicles…).
 *   2 blue    cycle | set   — a famous printed cycle (shock lands,
 *                             praetors, …) or four cards unique to one
 *                             premier set.
 *   3 purple  artist | lore — same illustrator, or a hand-curated
 *                             story connection (khans of Tarkir,
 *                             compleated planeswalkers…). Deep trivia.
 *
 * The generator's key trick — the thing NYT can't do with words — is
 * FORMAL uniqueness verification. Every group carries a computable
 * predicate, so for each candidate board we evaluate all 16 cards
 * against all 4 predicates and count the perfect partitions (exact
 * cover, 4 groups × 4 cards). Boards with any second valid solution
 * are rejected. Cards that satisfy two predicates but leave the
 * partition unique are *kept* and scored — those are the red herrings
 * that make a Connections board fun.
 */

import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CARDS_DIR = join(ROOT, "data", "set-cards");
const OUT_DIR = join(ROOT, "data", "connections");
const OUT_FILE = join(OUT_DIR, "puzzles.json");

/* ---------------- CLI args ---------------- */

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  if (i === -1 || i === args.length - 1) return fallback;
  return args[i + 1];
}
const TARGET_COUNT = Number(argValue("--count", "120"));
const SEED = Number(argValue("--seed", "1"));

/* ---------------- Deterministic PRNG ----------------
 * mulberry32 — reruns with the same seed + same input data produce the
 * same pool, so the daily schedule doesn't reshuffle under users every
 * time the script runs. Bump --seed to intentionally deal new boards. */

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);

/** Seeded in-place Fisher–Yates. */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Pick one random element. */
function pick(arr) {
  return arr[Math.floor(rand() * arr.length)];
}

/* ---------------- Themed wordlists (yellow tier) ----------------
 * Two lists per theme:
 *   words — the tight "core": only these qualify a card to be CHOSEN
 *           for the group, so the post-solve title stays honest
 *           ("A body of water" never claims "Tidal Wave" is one).
 *   also  — predicate-only extensions. The verifier's test() matches
 *           core ∪ also, so a card in another group whose name merely
 *           *reads* on-theme ("The Watcher in the Water", "Threefold
 *           Master") is caught by the clean-partition check and the
 *           board is rejected — never shipped as an invisible
 *           ambiguity. False positives here are safe: a too-broad
 *           `also` only rejects boards, it never mislabels a chosen
 *           card (choices come from `words` alone). */

const WORD_THEMES = [
  {
    key: "numbers",
    title: "Number in the name",
    words: ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "hundred", "thousand", "dozen", "twin", "triple", "zero", "eleven", "twelve", "thirteen", "twenty", "forty", "fifty", "million", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"],
    // `also` is verifier-only: these can't be CHOSEN (the title says
    // "number in the name", and "threefold" as an answer would read
    // oddly) but they DO count a card as number-ish for the
    // exclusivity check — so a board can't pair a numbers group with a
    // "Threefold Master" or "Twice-Told Tale" sitting in another
    // group. Err broad here; over-inclusion only rejects boards, it
    // never mislabels. This list is the direct fix for the reported
    // "Elsha, Threefold Master + Sheoldred, Whispering One" board.
    also: [
      "single", "double", "triple", "quadruple", "quintuple",
      "fifteen", "thirty", "sixty", "billion", "trillion",
      "once", "twice", "thrice",
      "twofold", "threefold", "fourfold", "fivefold", "sixfold", "tenfold", "hundredfold", "thousandfold", "manifold",
      "pair", "couple", "duo", "trio", "quartet", "quintet", "sextet",
      "solo", "lone", "sole", "twins", "myriad", "score",
    ],
    // Literal digits count too ("Spider-Man 2099", "Borrowing
    // 100,000 Arrows") — the tokenizer strips non-letters, so this
    // needs its own predicate arm; see the `digits` handling in
    // buildInstances and the phantom scanner.
    digits: true,
  },
  {
    key: "weather",
    title: "Weather in the name",
    words: ["storm", "rain", "thunder", "lightning", "frost", "snow", "mist", "fog", "wind", "hail", "blizzard", "tempest", "cyclone", "monsoon", "gale"],
    also: ["storms", "winds", "rains", "misty", "stormy", "squall", "sleet", "thundering", "thunderous", "snowfall", "windstorm", "frostbite"],
  },
  {
    key: "bodyparts",
    title: "Body part in the name",
    words: ["eye", "eyes", "hand", "hands", "heart", "tooth", "teeth", "bone", "bones", "skull", "tongue", "fist", "maw", "claw", "claws", "fang", "fangs", "spine", "jaw", "jaws", "blood", "brain", "wing", "wings", "horn", "horns", "tail"],
    also: ["gut", "guts", "hide", "flesh", "skin", "vein", "veins", "finger", "fingers", "heel", "hearts", "skulls", "fists", "tails", "spines", "tongues"],
  },
  {
    key: "celestial",
    title: "Something celestial in the name",
    words: ["sun", "moon", "star", "stars", "comet", "eclipse", "meteor", "cosmos", "constellation", "aurora", "nova", "zenith", "celestial"],
    also: ["suns", "moons", "starlight", "moonlight", "sunlight", "moonlit", "sunlit", "starfall", "starfield", "nebula"],
  },
  {
    key: "metals",
    title: "Metal in the name",
    words: ["iron", "gold", "golden", "silver", "copper", "steel", "bronze", "brass", "platinum", "chrome", "cobalt"],
    also: ["tin", "mercury", "leaden", "metal", "metallic", "quicksilver", "pewter", "gilded", "rust", "rusted", "rusty"],
  },
  {
    key: "royalty",
    title: "Royalty in the name",
    words: ["king", "queen", "prince", "princess", "monarch", "emperor", "empress", "royal", "crown", "throne", "regent", "sovereign"],
    also: ["baron", "duke", "duchess", "kings", "queens", "princes", "crowned", "coronation", "thrones", "imperial"],
  },
  {
    key: "fire",
    title: "Something fiery in the name",
    words: ["fire", "flame", "flames", "blaze", "ember", "embers", "inferno", "scorch", "burn", "burning", "pyre", "cinder", "magma", "lava", "molten"],
    also: ["ash", "ashes", "scorching", "blazing", "fiery", "ignite", "ignition", "incinerate", "char", "smolder", "smoldering", "burnt", "firestorm", "wildfire", "bonfire", "hellfire"],
  },
  {
    key: "water",
    title: "A body of water in the name",
    words: ["river", "lake", "sea", "ocean", "tide", "lagoon", "bay", "fjord", "delta", "pond", "stream", "brook", "marsh"],
    also: ["seas", "rivers", "lakes", "tides", "oceans", "streams", "ponds", "wave", "waves", "water", "waters", "flood", "flooded", "whirlpool", "riptide", "undertow", "loch", "estuary"],
  },
  {
    key: "time",
    title: "Time in the name",
    words: ["dawn", "dusk", "night", "midnight", "twilight", "hour", "moment", "eternity", "aeon", "epoch", "century", "morning", "evening", "tomorrow", "yesterday"],
    also: ["eternal", "hours", "moments", "nights", "nightfall", "daybreak", "noon", "midday", "sunrise", "sunset"],
  },
];

/* ---------------- Curated cycles (blue tier) ----------------
 * Only cycles whose member names share NO common word — a shared word
 * ("Sword of …", "… Titan") collapses the group into a trivial text
 * match. Members list is the FULL cycle; the predicate checks
 * membership so a cycle card sneaking into another group is caught. */

const CYCLES = [
  {
    key: "shocklands",
    title: "Ravnica shock lands",
    members: ["Blood Crypt", "Breeding Pool", "Godless Shrine", "Hallowed Fountain", "Overgrown Tomb", "Sacred Foundry", "Steam Vents", "Stomping Ground", "Temple Garden", "Watery Grave"],
  },
  {
    key: "fetchlands",
    title: "Fetch lands",
    members: ["Arid Mesa", "Bloodstained Mire", "Flooded Strand", "Marsh Flats", "Misty Rainforest", "Polluted Delta", "Scalding Tarn", "Verdant Catacombs", "Windswept Heath", "Wooded Foothills"],
  },
  {
    key: "painlands",
    title: "Pain lands",
    members: ["Adarkar Wastes", "Brushland", "Karplusan Forest", "Sulfurous Springs", "Underground River", "Battlefield Forge", "Caves of Koilos", "Llanowar Wastes", "Shivan Reef", "Yavimaya Coast"],
  },
  {
    key: "trilands",
    title: "Alara tri-lands",
    members: ["Arcane Sanctum", "Crumbling Necropolis", "Jungle Shrine", "Savage Lands", "Seaside Citadel"],
  },
  {
    key: "praetors",
    title: "Phyrexian praetors",
    members: ["Elesh Norn, Grand Cenobite", "Jin-Gitaxias, Core Augur", "Sheoldred, Whispering One", "Urabrask the Hidden", "Vorinclex, Voice of Hunger"],
  },
  {
    key: "kamigawa-dragons",
    title: "Kamigawa dragon spirits",
    members: ["Kokusho, the Evening Star", "Keiga, the Tide Star", "Ryusei, the Falling Star", "Yosei, the Morning Star", "Jugan, the Rising Star"],
  },
  {
    key: "surveil-lands",
    title: "Karlov Manor surveil lands",
    members: ["Commercial District", "Elegant Parlor", "Hedge Maze", "Lush Portico", "Meticulous Archive", "Raucous Theater", "Shadowy Backstreet", "Thundering Falls", "Undercity Sewers", "Underground Mortuary"],
  },
  {
    key: "filter-lands",
    title: "Filter lands",
    members: ["Cascade Bluffs", "Fetid Heath", "Fire-Lit Thicket", "Flooded Grove", "Graven Cairns", "Mystic Gate", "Rugged Prairie", "Sunken Ruins", "Twilight Mire", "Wooded Bastion"],
  },
];

/* ---------------- Creature subtypes (green tier) ----------------
 * Well-known tribes only — the group should feel like "oh, those are
 * all Wizards", not a subtype quiz on Homarid. */

const SUBTYPES = [
  "Angel", "Beast", "Bird", "Cat", "Cleric", "Demon", "Dinosaur", "Dragon",
  "Druid", "Elemental", "Elf", "Giant", "Goblin", "Hydra", "Knight",
  "Merfolk", "Pirate", "Rat", "Rogue", "Shaman", "Sliver", "Snake",
  "Soldier", "Sphinx", "Spider", "Spirit", "Squirrel", "Vampire", "Warrior",
  "Wizard", "Wolf", "Zombie",
];

/** Naive plural/possessive variants so "Llanowar Elves" is excluded
 *  from an Elf group's *chosen* cards (name leaks the answer). */
function subtypeNameForms(subtype) {
  const s = subtype.toLowerCase();
  const forms = [s, `${s}s`, `${s}es`];
  if (s.endsWith("f")) forms.push(`${s.slice(0, -1)}ves`); // elf → elves, wolf → wolves
  return forms;
}

/* ---------------- Non-creature card types (green tier) ----------------
 * "Which of these is the instant?" is classic MTG trivia. Only types
 * whose names don't systematically leak the answer; the generic
 * type-word-not-in-name check still applies per card. */

const CARD_TYPES = [
  { key: "Instant", match: (tl) => tl.includes("Instant") },
  { key: "Sorcery", match: (tl) => tl.includes("Sorcery") },
  { key: "Saga", match: (tl) => tl.includes("Saga") },
  { key: "Vehicle", match: (tl) => tl.includes("Vehicle") },
  { key: "Equipment", match: (tl) => tl.includes("Equipment") },
  { key: "Aura", match: (tl) => tl.includes("Aura") },
];

/* ---------------- Color identities (green tier) ----------------
 * "Same exact color identity" — the Commander-deckbuilding definition,
 * straight from Scryfall's color_identity field. Mono colors are
 * deliberately absent (pools too broad, signal too weak); pairs use
 * guild names, trios use shard/wedge names, plus five-color. Chosen
 * cards may not leak a color word or the identity's nickname in the
 * name; the verifier predicate is exact identity equality. */

const COLOR_WORDS = ["white", "blue", "black", "red", "green"];
const COLOR_IDENTITIES = [
  { key: "azorius", name: "Azorius", colors: ["U", "W"] },
  { key: "dimir", name: "Dimir", colors: ["B", "U"] },
  { key: "rakdos", name: "Rakdos", colors: ["B", "R"] },
  { key: "gruul", name: "Gruul", colors: ["G", "R"] },
  { key: "selesnya", name: "Selesnya", colors: ["G", "W"] },
  { key: "orzhov", name: "Orzhov", colors: ["B", "W"] },
  { key: "izzet", name: "Izzet", colors: ["R", "U"] },
  { key: "golgari", name: "Golgari", colors: ["B", "G"] },
  { key: "boros", name: "Boros", colors: ["R", "W"] },
  { key: "simic", name: "Simic", colors: ["G", "U"] },
  { key: "bant", name: "Bant", colors: ["G", "U", "W"] },
  { key: "esper", name: "Esper", colors: ["B", "U", "W"] },
  { key: "grixis", name: "Grixis", colors: ["B", "R", "U"] },
  { key: "jund", name: "Jund", colors: ["B", "G", "R"] },
  { key: "naya", name: "Naya", colors: ["G", "R", "W"] },
  { key: "abzan", name: "Abzan", colors: ["B", "G", "W"] },
  { key: "jeskai", name: "Jeskai", colors: ["R", "U", "W"] },
  { key: "sultai", name: "Sultai", colors: ["B", "G", "U"] },
  { key: "mardu", name: "Mardu", colors: ["B", "R", "W"] },
  { key: "temur", name: "Temur", colors: ["G", "R", "U"] },
  { key: "wubrg", name: "all five colors", colors: ["B", "G", "R", "U", "W"] },
];

/* ---------------- Lore groups (purple tier) ----------------
 * Hand-curated like CYCLES, but the connection is story knowledge
 * rather than a printed cycle. ONLY add groups whose membership is
 * beyond doubt — a factually wrong lore group poisons trust in the
 * whole game. Members must be exact card names present in the pool
 * (the loader skips any group with fewer than 4 available). */

const LORE_CYCLES = [
  {
    key: "gatewatch-founders",
    title: "Founding members of the Gatewatch",
    members: ["Gideon of the Trials", "Jace, Unraveler of Secrets", "Chandra, Torch of Defiance", "Nissa, Steward of Elements", "Liliana, Death's Majesty"],
  },
  {
    key: "innistrad-archangels",
    title: "Archangels of Innistrad",
    members: ["Avacyn, Angel of Hope", "Sigarda, Host of Herons", "Gisela, Blade of Goldnight", "Bruna, Light of Alabaster"],
  },
  {
    key: "amonkhet-gods",
    title: "Gods of Amonkhet",
    members: ["Hazoret the Fervent", "Oketra the True", "Kefnet the Mindful", "Bontu the Glorified", "Rhonas the Indomitable", "The Scarab God", "The Scorpion God", "The Locust God"],
  },
  {
    key: "tarkir-khans",
    title: "The five khans of Tarkir",
    members: ["Zurgo Helmsmasher", "Sidisi, Brood Tyrant", "Anafenza, the Foremost", "Surrak Dragonclaw", "Narset, Enlightened Master"],
  },
  {
    key: "mom-compleated",
    title: "Planeswalkers compleated by Phyrexia",
    members: ["Jace, the Perfected Mind", "Nissa, Ascended Animist", "Lukka, Bound to Ruin", "Nahiri, the Unforgiving", "Vraska, Betrayal's Sting"],
  },
];

/* ---------------- Premier sets for "printed in" groups ----------------
 * Allowlist keeps the blue set-tier on sets people actually associate
 * cards with. Masters/anthology reprint sets would be technically
 * correct but feel wrong ("Printed in Double Masters 2022"?). */

const PREMIER_SETS = [
  "neo", "snc", "dmu", "bro", "one", "mom", "woe", "lci", "mkm", "otj",
  "blb", "dsk", "fdn", "dft", "tdm", "eoe", "khm", "stx", "afr", "mid",
  "vow", "znr", "iko", "thb", "eld", "war", "rna", "grn", "dom", "rix",
  "xln", "hou", "akh", "aer", "kld", "emn", "soi", "ogw", "bfz",
];

/* ---------------- Load + filter the card pool ---------------- */

/** Word-boundary token list for a card name: lowercase, split on
 *  anything that isn't a letter (hyphens, commas, apostrophes all
 *  break words — "Two-Headed" yields "two","headed"). Digits are
 *  stripped here; the numbers theme detects them separately. */
function nameTokens(name) {
  return name.toLowerCase().split(/[^a-z]+/).filter(Boolean);
}

/** First run of digits (with grouping commas) in a name, or null —
 *  "Spider-Man 2099" → "2099", "Borrowing 100,000 Arrows" →
 *  "100,000". Used only by the digit-aware numbers theme. */
function digitRun(name) {
  const m = name.match(/\d[\d,]*/);
  return m ? m[0] : null;
}

// Sets we never want puzzle cards from: Un-sets (joke names with
// nonstandard formatting read terribly as text tiles).
const EXCLUDED_SETS = new Set(["ugl", "unh", "ust", "und", "unf"]);

function loadPool() {
  /** @type {Map<string, any>} name → chosen printing */
  const byName = new Map();
  /** @type {Map<string, Set<string>>} name → every pool set containing it */
  const nameSets = new Map();

  const files = readdirSync(CARDS_DIR).filter((f) => f.endsWith(".json.gz"));
  for (const file of files) {
    let cards;
    try {
      cards = JSON.parse(gunzipSync(readFileSync(join(CARDS_DIR, file))).toString("utf8"));
    } catch {
      continue; // corrupt/partial file — build-set-cards will refresh it
    }
    if (!Array.isArray(cards)) continue;
    for (const c of cards) {
      if (!c || typeof c.name !== "string") continue;
      // English printings only — the pools include foreign-language
      // variants (booster localization), and a German tile in an
      // English word puzzle is nonsense.
      if (c.lang && c.lang !== "en") continue;
      if (c.digital || c.oversized) continue;
      if (EXCLUDED_SETS.has(c.set)) continue;
      const tl = c.type_line || "";
      if (tl.startsWith("Basic Land") || tl.includes("Token")) continue;
      if (["token", "emblem", "art_series", "double_faced_token", "scheme", "planar", "vanguard"].includes(c.layout)) continue;
      // Skip DFC / split names — " // " tiles are unreadable and the
      // face names leak the trick anyway.
      if (c.name.includes("//")) continue;
      if (c.name.length > 30) continue;
      if (!c.image_uris || !c.image_uris.normal || !c.image_uris.art_crop) continue;

      let set = nameSets.get(c.name);
      if (!set) nameSets.set(c.name, (set = new Set()));
      set.add(c.set);

      const prev = byName.get(c.name);
      // Prefer plain in-booster printings over promos/etched variants
      // so the revealed art is the version people recognize.
      const score = (c.booster ? 2 : 0) + (c.promo_types?.length ? 0 : 1);
      const prevScore = prev ? (prev.booster ? 2 : 0) + (prev.promo_types?.length ? 0 : 1) : -1;
      if (!prev || score > prevScore) byName.set(c.name, c);
    }
  }
  return { byName, nameSets };
}

/* ---------------- Group instances + predicates ---------------- */

/**
 * Build every concrete group instance available in the pool. Each
 * instance carries:
 *   - archetype, key, title, difficulty
 *   - candidates: card names eligible to be *chosen* for the group
 *   - test(card): the predicate the verifier runs against ALL 16 cards
 *     (deliberately broader than `candidates` — e.g. an Elf whose name
 *     says "Elves" can't be chosen for the Elf group, but it still
 *     *matches* it, and the verifier must know that).
 *
 * `byName` may be a filtered sub-pool (the recent-sets pass), but
 * `nameSets` must ALWAYS be the full name→sets map so "printed in
 * exactly one set" stays true against the whole catalog. opts:
 *   - artistMin: unique-name floor for artist groups (the recent
 *     window is ~6 sets, so 28 would leave no artists at all)
 *   - premierCodes: allowlist for "printed in <set>" groups
 */
function buildInstances(byName, nameSets, opts = {}) {
  const { artistMin = 28, premierCodes = PREMIER_SETS } = opts;
  const all = [...byName.values()];
  const instances = { hiddenWord: [], green: [], blue: [], purple: [] };

  // hiddenWord — candidates come from the tight core list; the
  // verifier predicate matches core ∪ also (see WORD_THEMES note).
  for (const theme of WORD_THEMES) {
    const coreSet = new Set(theme.words);
    const fullSet = new Set([...theme.words, ...theme.also]);
    const digits = !!theme.digits;
    const cands = [];
    for (const c of all) {
      const hit = nameTokens(c.name).find((t) => coreSet.has(t));
      if (hit) {
        cands.push({ name: c.name, word: hit });
      } else if (digits) {
        // Digit-only match ("2099") — bucket by the digit string so a
        // board can still hold two distinct digit cards but not four
        // copies of the same one (the seenWords dedup uses `word`).
        const d = digitRun(c.name);
        if (d) cands.push({ name: c.name, word: d });
      }
    }
    if (cands.length < 8) continue;
    instances.hiddenWord.push({
      archetype: "hiddenWord",
      key: `word:${theme.key}`,
      title: theme.title,
      difficulty: 0,
      candidates: cands,
      test: (card) =>
        (digits && digitRun(card.name) !== null) ||
        nameTokens(card.name).some((t) => fullSet.has(t)),
    });
  }

  // creatureType — creatures of the subtype whose names don't say so.
  for (const subtype of SUBTYPES) {
    const forms = new Set(subtypeNameForms(subtype));
    const test = (card) => {
      const tl = card.type_line || "";
      if (!tl.includes("Creature")) return false;
      const sub = tl.split("—")[1] || "";
      return sub.split(/[\s/]+/).includes(subtype);
    };
    const cands = all
      .filter((c) => test(c) && !nameTokens(c.name).some((t) => forms.has(t)))
      .map((c) => ({ name: c.name }));
    if (cands.length < 8) continue;
    instances.green.push({
      archetype: "creatureType",
      key: `type:${subtype}`,
      title: `Creature type: ${subtype}`,
      difficulty: 1,
      candidates: cands,
      test,
    });
  }

  // cardType — non-creature types, same "name mustn't leak it" rule.
  for (const ct of CARD_TYPES) {
    const forms = new Set(subtypeNameForms(ct.key));
    const test = (card) => ct.match(card.type_line || "");
    const cands = all
      .filter((c) => test(c) && !nameTokens(c.name).some((t) => forms.has(t)))
      .map((c) => ({ name: c.name }));
    if (cands.length < 8) continue;
    instances.green.push({
      archetype: "cardType",
      key: `cardtype:${ct.key}`,
      title: `Card type: ${ct.key}`,
      difficulty: 1,
      candidates: cands,
      test,
    });
  }

  // colorIdentity — exact identity equality (Commander definition).
  for (const ci of COLOR_IDENTITIES) {
    const want = [...ci.colors].sort().join("");
    const leak = new Set([...COLOR_WORDS, ci.key, ci.name.toLowerCase()]);
    const test = (card) =>
      Array.isArray(card.color_identity) &&
      [...card.color_identity].sort().join("") === want;
    const cands = all
      .filter((c) => test(c) && !nameTokens(c.name).some((t) => leak.has(t)))
      .map((c) => ({ name: c.name }));
    if (cands.length < 8) continue;
    const label =
      ci.colors.length === 5 ? ci.name : `${ci.name} (${ci.colors.join("")})`;
    instances.green.push({
      archetype: "colorIdentity",
      key: `color:${ci.key}`,
      title: `Color identity: ${label}`,
      difficulty: 1,
      candidates: cands,
      test,
    });
  }

  // cycles — only members present in the pool count.
  for (const cycle of CYCLES) {
    const present = cycle.members.filter((m) => byName.has(m));
    if (present.length < 4) continue;
    const memberSet = new Set(cycle.members);
    instances.blue.push({
      archetype: "cycle",
      key: `cycle:${cycle.key}`,
      title: cycle.title,
      difficulty: 2,
      candidates: present.map((name) => ({ name })),
      test: (card) => memberSet.has(card.name),
    });
  }

  // premier-set exclusives — names printed in exactly one pool set.
  for (const code of premierCodes) {
    const cands = [];
    let setName = null;
    for (const c of all) {
      if (c.set !== code) continue;
      if (nameSets.get(c.name)?.size !== 1) continue; // pool-unique → no reprint ambiguity
      setName = setName || c.set_name;
      cands.push({ name: c.name });
    }
    if (!setName || cands.length < 8) continue;
    instances.blue.push({
      archetype: "set",
      key: `set:${code}`,
      title: `Printed in ${setName}`,
      difficulty: 2,
      candidates: cands,
      test: (card) => nameSets.get(card.name)?.has(code) ?? false,
    });
  }

  // lore — curated story groups; membership predicate like cycles.
  for (const lore of LORE_CYCLES) {
    const present = lore.members.filter((m) => byName.has(m));
    if (present.length < 4) continue;
    const memberSet = new Set(lore.members);
    instances.purple.push({
      archetype: "lore",
      key: `lore:${lore.key}`,
      title: lore.title,
      difficulty: 3,
      candidates: present.map((name) => ({ name })),
      test: (card) => memberSet.has(card.name),
    });
  }

  // artists — need enough distinct names that four picks stay varied.
  const byArtist = new Map();
  for (const c of all) {
    if (!c.artist || c.artist.includes("&")) continue; // skip collabs — ambiguous credit
    let list = byArtist.get(c.artist);
    if (!list) byArtist.set(c.artist, (list = []));
    list.push(c.name);
  }
  for (const [artist, names] of byArtist) {
    // Default 28+ unique names ≈ "prolific enough that enfranchised
    // players have seen the style" — keeps the purple tier fair trivia
    // instead of a quiz on artists with one commission in 1997.
    if (names.length < artistMin) continue;
    instances.purple.push({
      archetype: "artist",
      key: `artist:${artist}`,
      title: `Art by ${artist}`,
      difficulty: 3,
      candidates: names.map((name) => ({ name })),
      test: (card) => card.artist === artist,
    });
  }

  return instances;
}

/* ---------------- Phantom-connection scanner ----------------
 * The uniqueness verifier proves there is exactly one valid PARTITION
 * — but four cards spread across different groups could still share a
 * connection from the game's own vocabulary (a fifth artist, a stray
 * tribe, a second word theme). A player can't submit it as correct,
 * but it reads as a trap with no answer. This scanner rejects any
 * board where ≥4 cards match a library instance that isn't one of the
 * four intended groups.
 *
 * Scope is deliberately the game's OWN category space (curated
 * subtypes, the 21 identities, the 9 word themes, all artists, card
 * types, cycles, lore). Beyond-library associations — all legendary,
 * all Human, all mono-red — stay possible; those are ordinary red
 * herrings, not phantoms the game itself taught players to look for.
 * Pool-set overlap is also skipped: reprint sets (2XM etc.) put
 * random quartets in the same set constantly, and set membership
 * isn't readable off a tile anyway.
 */

function makePhantomScanner() {
  const themeSets = WORD_THEMES.map((t) => ({
    key: `word:${t.key}`,
    words: new Set([...t.words, ...t.also]),
    digits: !!t.digits,
  }));
  const identitySet = new Map(
    COLOR_IDENTITIES.map((ci) => [[...ci.colors].sort().join(""), `color:${ci.key}`]),
  );
  const memberLists = [...CYCLES.map((c) => ({ key: `cycle:${c.key}`, set: new Set(c.members) })),
    ...LORE_CYCLES.map((l) => ({ key: `lore:${l.key}`, set: new Set(l.members) }))];
  const subtypeSet = new Set(SUBTYPES);

  /** cards16: resolved card objects; boardKeys: the 4 instance keys. */
  return function phantomFree(cards16, boardKeys) {
    const exclude = new Set(boardKeys);
    const counts = new Map(); // instance-key → matching cards

    const bump = (key) => counts.set(key, (counts.get(key) ?? 0) + 1);

    for (const c of cards16) {
      if (c.artist && !c.artist.includes("&")) bump(`artist:${c.artist}`);

      const tl = c.type_line || "";
      if (tl.includes("Creature")) {
        const subs = (tl.split("—")[1] || "").split(/[\s/]+/).filter(Boolean);
        for (const s of new Set(subs)) if (subtypeSet.has(s)) bump(`type:${s}`);
      }
      for (const ct of CARD_TYPES) if (ct.match(tl)) bump(`cardtype:${ct.key}`);

      if (Array.isArray(c.color_identity)) {
        const idKey = identitySet.get([...c.color_identity].sort().join(""));
        if (idKey) bump(idKey);
      }

      const tokens = new Set(nameTokens(c.name));
      const hasDigit = digitRun(c.name) !== null;
      for (const t of themeSets) {
        if (t.digits && hasDigit) {
          bump(t.key);
          continue;
        }
        for (const tok of tokens) {
          if (t.words.has(tok)) {
            bump(t.key);
            break;
          }
        }
      }

      for (const m of memberLists) if (m.set.has(c.name)) bump(m.key);
    }

    for (const [key, n] of counts) {
      if (n >= 4 && !exclude.has(key)) return false;
    }
    return true;
  };
}

/* ---------------- Uniqueness verifier ----------------
 * Count perfect partitions of the 16 cards into the 4 labeled groups
 * (4 each) where every card satisfies its group's predicate. The board
 * is legal iff the count is exactly 1. DFS with most-constrained-first
 * ordering; early-exits as soon as a second solution appears. */

function countPartitions(matrix) {
  // matrix: 16 rows × 4 cols of booleans (card i satisfies group g)
  const order = matrix
    .map((row, i) => ({ i, opts: row.reduce((n, b) => n + (b ? 1 : 0), 0) }))
    .sort((a, b) => a.opts - b.opts)
    .map((x) => x.i);
  if (order.some((i) => matrix[i].every((b) => !b))) return 0;

  const counts = [0, 0, 0, 0];
  let found = 0;
  function dfs(k) {
    if (found >= 2) return;
    if (k === order.length) {
      found++;
      return;
    }
    const i = order[k];
    for (let g = 0; g < 4; g++) {
      if (!matrix[i][g] || counts[g] === 4) continue;
      counts[g]++;
      dfs(k + 1);
      counts[g]--;
      if (found >= 2) return;
    }
  }
  dfs(0);
  return found;
}

/* ---------------- Board assembly ---------------- */

const phantomFree = makePhantomScanner();
let phantomRejects = 0;
let cleanRejects = 0;

const FNV_OFFSET = 0x811c9dc5;
function fnv1a(str) {
  let h = FNV_OFFSET;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function tryBuildBoard(byName, chosenInstances) {
  const [words, type, blue, artist] = chosenInstances;
  const groups = [words, type, blue, artist];
  const used = new Set();
  const picked = [];

  for (const inst of groups) {
    const pool = shuffle(inst.candidates.slice());
    const sel = [];
    const seenWords = new Set();
    for (const cand of pool) {
      if (sel.length === 4) break;
      if (used.has(cand.name)) continue;
      // hiddenWord groups want four DIFFERENT matched words — four
      // "Storm …" tiles is a lazier puzzle than storm/rain/frost/gale.
      if (cand.word) {
        if (seenWords.has(cand.word)) continue;
        seenWords.add(cand.word);
      }
      sel.push(cand.name);
      used.add(cand.name);
    }
    if (sel.length < 4) return null;
    picked.push(sel);
  }

  // Verify: build the 16×4 membership matrix from the full predicates.
  const cards16 = picked.flat().map((name) => byName.get(name));
  const matrix = cards16.map((card) => groups.map((g) => g.test(card)));

  // CLEAN PARTITION — the headline fairness rule. Every card must
  // satisfy EXACTLY ONE group's predicate. A card that matches two
  // (e.g. "Sheoldred, Whispering One" is a praetor AND contains the
  // number word "one") makes the board unsolvable by a human: they see
  // 5-6 tiles fitting one category and can't tell which four are the
  // group, even though the exact-cover MATH stays unique. This check
  // supersedes the old "spice = reward red herrings" idea — in a game
  // whose categories are mechanical text/type facts, a second true
  // predicate isn't a fun trap, it's a broken clue. Chosen cards
  // always match their own group, so the test is simply "no row with
  // two or more trues".
  if (matrix.some((row) => row.reduce((n, b) => n + (b ? 1 : 0), 0) !== 1)) {
    cleanRejects++;
    return null;
  }

  // Redundant given a clean partition (the solution is now forced),
  // but kept as a cheap assertion that the logic holds.
  if (countPartitions(matrix) !== 1) return null;

  // No phantom quartets from the game's own category library.
  if (!phantomFree(cards16, groups.map((g) => g.key))) {
    phantomRejects++;
    return null;
  }

  return {
    id: fnv1a(picked.flat().sort().join("|")),
    groups: groups.map((inst, gi) => ({
      key: inst.key,
      title: inst.title,
      difficulty: inst.difficulty,
      cards: picked[gi].map((name) => {
        const c = byName.get(name);
        return {
          name,
          set: c.set,
          cn: String(c.collector_number),
          art: c.image_uris.art_crop,
          img: c.image_uris.normal,
        };
      }),
    })),
  };
}

/* ---------------- Set release dates (for the "recent" tag) ----------------
 * One paginated call to Scryfall's /sets endpoint (the 10 req/s class,
 * NOT the throttled /cards/search class — see AGENTS.md). Failure is
 * non-fatal: without dates we simply skip the recent pass/tags, so the
 * script still works fully offline. */

const RECENT_MONTHS = 18; // ≈ the last 6 premier sets

async function fetchSetInfo() {
  const out = new Map(); // code → { releasedAt, setType }
  let url = "https://api.scryfall.com/sets";
  try {
    while (url) {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "threetreecity-connections-build/1.0",
          Accept: "application/json",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const page = await res.json();
      for (const s of page.data ?? []) {
        if (s.code && s.released_at) {
          out.set(s.code, { releasedAt: s.released_at, setType: s.set_type });
        }
      }
      url = page.has_more ? page.next_page : null;
    }
    return out;
  } catch (err) {
    console.warn(`  /sets fetch failed (${err.message}) — skipping recent tags`);
    return null;
  }
}

/* ---------------- Board generation pass ---------------- */

/**
 * Assemble up to `target` verified boards from one instance pool.
 * Dedup state (`seenIds`, `seenCombos`, `cardUse`) is shared across
 * passes so the recent pass can't re-deal a catalog board; `passTag`
 * keeps a combo that failed in one pass available to the other.
 */
function generateBoards(byName, instances, target, state, passTag) {
  const { seenIds, seenCombos, cardUse } = state;
  const puzzles = [];

  // Rarity-weighting within each slot: instance counts are wildly
  // uneven (8 cycles vs ~40 sets, 6 card types vs ~30 creature types,
  // 5 lore groups vs ~300 artists), so uniform picks would bury the
  // scarcer — and usually more delightful — archetypes.
  const blueWeighted = instances.blue.flatMap((inst) =>
    inst.archetype === "cycle" ? Array(5).fill(inst) : [inst],
  );
  const greenWeighted = instances.green.flatMap((inst) =>
    inst.archetype === "cardType" ? Array(2).fill(inst) : [inst],
  );
  const purpleWeighted = instances.purple.flatMap((inst) =>
    inst.archetype === "lore" ? Array(8).fill(inst) : [inst],
  );
  if (!instances.hiddenWord.length || !greenWeighted.length || !blueWeighted.length || !purpleWeighted.length) {
    console.warn(`  [${passTag}] a slot has zero instances — skipping pass`);
    return puzzles;
  }

  let attempts = 0;
  const MAX_ATTEMPTS = target * 400;
  while (puzzles.length < target && attempts < MAX_ATTEMPTS) {
    attempts++;
    const combo = [
      pick(instances.hiddenWord),
      pick(greenWeighted),
      pick(blueWeighted),
      pick(purpleWeighted),
    ];
    const comboKey = `${passTag}:` + combo.map((i) => i.key).sort().join("+");
    if (seenCombos.has(comboKey)) continue;

    // Try a handful of card selections for this combo and take the
    // first that survives every gate (clean partition, uniqueness,
    // phantom scan, freshness cap). Boards no longer carry a "spice"
    // score — every legal board is overlap-free by construction, so
    // there's nothing to rank; we just want one that passes.
    let chosen = null;
    for (let k = 0; k < 8; k++) {
      const board = tryBuildBoard(byName, combo);
      if (!board) continue;
      if (seenIds.has(board.id)) continue;
      if (board.groups.some((g) => g.cards.some((c) => (cardUse.get(c.name) ?? 0) >= 3))) continue;
      chosen = board;
      break;
    }
    if (!chosen) continue;

    seenCombos.add(comboKey);
    seenIds.add(chosen.id);
    for (const g of chosen.groups) for (const c of g.cards) cardUse.set(c.name, (cardUse.get(c.name) ?? 0) + 1);
    puzzles.push(chosen);
  }

  if (puzzles.length < target) {
    console.warn(`  [${passTag}] assembled ${puzzles.length}/${target} boards (instance pool exhausted)`);
  }
  return puzzles;
}

/* ---------------- Main ---------------- */

async function main() {
  console.log("Loading card pools…");
  const { byName, nameSets } = loadPool();
  console.log(`  ${byName.size} unique English card names`);

  const setInfo = await fetchSetInfo();

  // Premier expansions straight from Scryfall metadata when available —
  // future sets join "printed in <set>" groups without touching the
  // hardcoded fallback list.
  const dynamicPremier = new Set(PREMIER_SETS);
  const recentCodes = new Set();
  if (setInfo) {
    const cutoff = Date.now() - RECENT_MONTHS * 30.44 * 86_400_000;
    for (const [code, info] of setInfo) {
      if (info.setType === "expansion") {
        dynamicPremier.add(code);
        if (Date.parse(info.releasedAt) >= cutoff) recentCodes.add(code);
      }
    }
    console.log(`  recent premier sets (${RECENT_MONTHS}mo): ${[...recentCodes].join(", ") || "none"}`);
  }

  const instances = buildInstances(byName, nameSets, {
    premierCodes: [...dynamicPremier],
  });
  console.log(
    `  instances: ${instances.hiddenWord.length} word themes, ` +
      `${instances.green.length} creature/card/color types, ` +
      `${instances.blue.length} cycles/sets, ${instances.purple.length} artists/lore`,
  );

  const state = { seenIds: new Set(), seenCombos: new Set(), cardUse: new Map() };
  const puzzles = generateBoards(byName, instances, TARGET_COUNT, state, "catalog");

  // Second pass: boards drawn only from the recent premier window, so
  // the endless "newer sets" filter has real inventory (an all-recent
  // board almost never falls out of the full-catalog pass by chance).
  if (recentCodes.size >= 4) {
    const recentByName = new Map(
      [...byName].filter(([, c]) => recentCodes.has(c.set)),
    );
    console.log(`  recent sub-pool: ${recentByName.size} names`);
    const recentInstances = buildInstances(recentByName, nameSets, {
      artistMin: 12,
      premierCodes: [...recentCodes],
    });
    puzzles.push(
      ...generateBoards(recentByName, recentInstances, Math.round(TARGET_COUNT / 3), state, "recent"),
    );
  }

  // Tag EVERY board (either pass) whose 16 cards are all available in
  // the recent window — reprints in a recent set count as recent.
  if (recentCodes.size > 0) {
    for (const pz of puzzles) {
      const allRecent = pz.groups.every((g) =>
        g.cards.every((c) => {
          const sets = nameSets.get(c.name);
          return sets && [...sets].some((s) => recentCodes.has(s));
        }),
      );
      if (allRecent) pz.recent = true;
    }
    console.log(`  boards tagged recent: ${puzzles.filter((p) => p.recent).length}/${puzzles.length}`);
  }

  console.log(`  boards rejected — cross-group overlap: ${cleanRejects}, phantom scan: ${phantomRejects}`);

  shuffle(puzzles); // schedule order ≠ generation order

  mkdirSync(OUT_DIR, { recursive: true });
  const payload = {
    _doc:
      "Generated by scripts/build-connections.mjs — do not hand-edit. " +
      "Hand-authored boards belong in data/connections/curated.json instead.",
    generatedAt: new Date().toISOString(),
    seed: SEED,
    epoch: "2026-07-23",
    puzzles,
  };
  writeFileSync(OUT_FILE, JSON.stringify(payload, null, 1) + "\n");
  console.log(`Wrote ${puzzles.length} puzzles → ${OUT_FILE}`);

  // Scaffold the curated-overrides file on first run only — it's a
  // hand-maintained file, never clobber it.
  const curatedPath = join(OUT_DIR, "curated.json");
  if (!existsSync(curatedPath)) {
    writeFileSync(
      curatedPath,
      JSON.stringify(
        {
          _doc:
            "Hand-authored daily overrides for Confluence. Keys are UTC dates " +
            "(YYYY-MM-DD); values use the same puzzle shape as puzzles.json " +
            "(id + groups[4] each with title/difficulty/cards[4]). A date " +
            "present here replaces the generated rotation for that day. " +
            "Keys starting with _ are ignored.",
          byDate: {},
        },
        null,
        1,
      ) + "\n",
    );
    console.log(`Scaffolded ${curatedPath}`);
  }
}

await main();
