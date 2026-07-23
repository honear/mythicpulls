<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project: Three Tree City

Magic: the Gathering booster-opening / sealed / draft simulator. Repo
folder is still `mythicpulls` (legacy name); site is branded
**Three Tree City** — the name of a Wizards-printed Magic card
(originally LTR, reprinted in Bloomburrow), used as an affectionate
fan nod. Earlier rebrands: `Mythic Pulls` → `Mythic Grounds` →
`Three Tree City`. Fan project under Wizards' Fan Content Policy —
non-commercial, donations allowed (Ko-fi / GitHub Sponsors).

## Branding & names

- **UI / metadata** says "Three Tree City" everywhere (`<title>`, footer,
  legal page, header wordmark).
- **localStorage keys** stay on the legacy `mythicpulls:` prefix —
  renaming would silently wipe every existing user's binder + holo
  setting. Treat them as immutable identifiers. Both `lib/collection.ts`
  and `app/_components/HoloToggle.tsx` have comments explaining this.
- Repo folder, `package.json` name (`threetreecity`), and git history
  retain the legacy paths. Don't rename the folder.

## Static-data pattern (preferred over runtime fetch)

For any third-party API we depend on (Scryfall art, 17Lands stats),
**pre-fetch into static JSON via a script in `scripts/`** instead of
calling the API at SSR/runtime. Established examples:

| Script | Writes to | Read via |
|---|---|---|
| `scripts/build-set-art.mjs` | `data/set-art.json` | `lib/set-art.ts` |
| `scripts/fetch-17lands.mjs` | `data/draft-stats/<code>.json` | `lib/draft-stats.ts` |
| `scripts/fetch-manapool-prices.mjs` | `data/manapool-prices.json` | `lib/manapool.ts` |
| `scripts/build-connections.mjs` | `data/connections/puzzles.json` | `lib/connections.ts` |

Why: cold renders were ~20s when calling Scryfall live for 175 sets.
Static JSON imports drop that to ~200ms.

Pages should read the static map first, then optionally live-fetch any
set still missing (covers brand-new releases between script runs).

## Scryfall rate limit

Per the official docs (https://scryfall.com/docs/api/rate-limits), the
limits are **per endpoint class**: `/cards/search`, `/cards/named`,
`/cards/random`, `/cards/collection` are capped at **2 req/sec (500ms)**;
all other endpoints at 10 req/sec. A 429 locks you out for 30 seconds and
repeat offenders risk a ban. The earlier "10 req/sec flat" note here was
wrong for search — long crawls at 4-8 req/sec drew sustained 429 streaks.

For anything bulk, Scryfall says you **must use the daily bulk data
files** (`/bulk-data` → `*.scryfall.io` download, NO rate limit on the
file origin). `scripts/build-set-cards.mjs` does this by default: one
~2.4 GB `all_cards` download, stream-parsed locally into every pool.
Its API mode (explicit codes / `--missing-only`) paces `/cards/search`
at 600ms and is for small refreshes only.

## 17Lands attribution requirements

Their [usage_guidelines](https://www.17lands.com/usage_guidelines)
require citation **at the top level** of any page that uses their data,
**not in a footnote or tooltip**. Stylized as **"17Lands"** (capital L).
Must NOT imply endorsement.

- Pages currently citing: `/draft` (set picker) + `/draft/[code]`
  (active draft). Pill: "Card pick data retrieved from 17Lands".
- `setHasDraftStats` lookup in `lib/draft-stats-meta.ts` (lightweight)
  vs `lib/draft-stats.ts` (heavy JSON imports) — keep the meta loader
  on any page that only needs the yes/no badge, so we don't bloat the
  home-page bundle with ~5 MB of card aggregates.

## Wizards Fan Content Policy

Donations ARE allowed per FCP: *"You can, however, subsidize your Fan
Content by taking advantage of sponsorships, ad revenue, and donations
— so long as it doesn't interfere with the Community's access to your
Fan Content."* The current `Support` button (Ko-fi iframe in a modal)
is fine. Site must stay free; nothing gated behind donation.

## Set filter

`getOpenableSets()` in `lib/scryfall.ts` filters out sets with fewer
than **`MIN_CARDS_FOR_PACK = 100`** cards. Below that the pack engine
produces nonsense (foreign reprints, tiny specialty boxes, etc.).
`scripts/build-set-art.mjs` mirrors the same constant — keep them in
sync.

## Coming-soon gate (unreleased sets)

Unreleased sets within **`PREVIEW_LOOKAHEAD_DAYS = 30`** of street date
(also mirrored in `build-set-art.mjs`) appear in the `/sets` catalog as
**"Coming soon"** teasers: amber `Soon` tile pill, and all three per-set
routes (`/sets/[code]`, `/sealed/[code]`, `/draft/[code]`) render
`app/_components/ComingSoonSetPage` — release date, preview card count,
Mana Pool preorder link — instead of their flows. The draft and sealed
*pickers* omit unreleased sets entirely. Gate predicate:
`isComingSoonSet(set, todayIso)` in `lib/scryfall.ts`; pass a
server-computed `todayIso()` into client components. The gate lifts
itself on release day — **re-run `scripts/build-set-cards.mjs` for the
set that week** so day-one packs roll the full pool, and audit any
preview-era CN-block filters (see `_doc_hob` in `data/filters.json` for
the HOB example).

## Booster pricing

**Mana Pool is the primary source of pack prices**, with a hand-set
MSRP fallback on the booster-contents JSON. Chain (high → low):

1. **Mana Pool live market price** (market > low NM > low any-condition)
   for (setCode, packType) — sourced from `data/manapool-prices.json`,
   refreshed by `scripts/fetch-manapool-prices.mjs` against
   `https://manapool.com/api/v1/prices/sealed` (public, no auth, ~1700
   in-stock products). Run `npm run refresh:manapool` weekly.
2. **Set-specific `costUsd`** in `data/booster-contents/<setCode>.json`
   — only consulted by the server-side `resolveRecipe` path (the route
   layer's `costs` prop). Used as the MSRP fallback for sets Mana Pool
   doesn't currently stock.
3. **Default `costUsd`** in `data/booster-contents/default.json` — the
   universal MSRP fallback (play 5.99, draft 3.99, collector 25.99).
   Bundled into the client so `getPackCost` can read it sync.
4. **`null` / undefined** — UI renders **"Not available"** on the rip
   button and `—` for Spent / Profit if every priced pack tally so far
   has been null.

Wired through `getPackCost` (sync, client MoneyStrip — returns
`number | null`) and `resolveRecipe` (async, server route — sets
`costUsd` to `undefined` only when steps 1–3 all miss).

The Mana Pool integration also powers deep "Buy on Mana Pool" links and
per-card live prices — see "Mana Pool integration" below.

## Booster recipes (per-set overrides)

To customize what a set's pack contains, drop a file at
`data/booster-contents/<setCode>.json` (lowercase). The file is auto-
discovered by `lib/booster-loader.ts::resolveRecipe` — there is no
`data/sets/` indirection. Define only the pack types that differ from
the global default; missing types fall through to
`data/booster-contents/default.json`.

Example: `data/booster-contents/sos.json` defines `play` + `collector`
(SOS-specific recipes for the Mystical Archive & Special Guests slots);
the `draft` pack type is undefined, so SOS draft boosters automatically
use the default draft recipe.

Sets without a dedicated content file use the default recipe for every
pack type. `packsAvailableForSet` combines a date-based heuristic with
what the set's content file defines, so a one-off custom set can
extend its available pack types beyond the date heuristic.

## Mana Pool integration

`lib/manapool.ts` is the single entry point.

- **Affiliate handle** lives in `NEXT_PUBLIC_MANAPOOL_REF` (optional;
  links go out un-tagged when unset). When set, gets appended as `?ref=`
  on every Mana Pool URL via `withManaPoolRef()`. Sign up at
  https://manapool.com/affiliates — 5% on first sale, 7-day cookie.
- **Pack buy button** in MoneyStrip (PackOpener) hides when there's no
  current stock for that (set, packType) so we never render a dead link.
  Generic "Booster Pack" listings on pre-modern sets (10E, M-series) map
  to the "draft" pack type as a fallback.
- **Card buy button** in CardDetailModal is built from
  `/card/<set>/<collector_number>` which 301-redirects to the canonical
  slug — works for any Scryfall card without per-card API calls.
- When Mana Pool has no listing, prices fall back to the booster-
  contents `costUsd` map (see "Booster pricing" above for the full
  chain). "Not available" only renders when both Mana Pool and the
  MSRP fallback are missing. The legacy `data/booster-prices.json`
  file was removed during the consolidation; do not re-add it — MSRPs
  now live alongside the recipes in `data/booster-contents/*.json`.

## Card image rendering

- **JPEG** not PNG. Picked by render width via `preferredImageSize` in
  `app/_components/MagicCard.tsx`: `large` (672w) for renders > 175 px,
  `normal` (488w) otherwise.
- Rounded corners come from **CSS clipping**, not PNG transparency.
  `--card-radius: calc(var(--card-base) * 2.5 / 63)` is **redeclared
  inside `.card-mtg`** so it scales per-card-width — the `@theme`
  declaration captures `:root`'s 180 px default and won't update against
  inline overrides.
- `.card-mtg__face` uses `border-radius: var(--card-radius)`, NOT
  `inherit`, because its parent is `.card-flip` (no radius), not
  `.card-mtg`. Custom-property inheritance carries the value through.

## Modal / popup conventions

- **Portal to `document.body`** via `createPortal` for any modal. The
  site header sets `backdrop-filter`, which creates a new containing
  block for `position: fixed` descendants — any modal rendered inside
  the header gets clipped to its 74 px height. CardDetailModal,
  ExportModal, SupportButton, and the mobile menu drawer all portal.
- Standard z-index for modals: **`z-[1200]`** (matches CardDetailModal).
- Backdrop click + Escape key + close button = three dismiss paths.
- Lock body scroll while open (`document.body.style.overflow = "hidden"`).

## Foil shimmer (HoloToggle)

Two states only: **"Foil On"** (shimmer) and **"Foil Off"**. Lives in
the MoneyStrip on `/sets/[code]`, not in the site nav. Legacy
localStorage value `"masked"` is coerced back to `"shimmer"` on load.

## Donation handles

- Ko-fi: `honear` → `https://ko-fi.com/honear` (in-page iframe modal
  with `hidefeed=true`)
- GitHub Sponsors: `honear` → `.github/FUNDING.yml` lists both for the
  repo page sponsor button

## Mobile breakpoint

Tailwind's `sm` (640 px). Mobile-only logic uses a local `useIsMobile()`
matching `(max-width: 639px)`. Several components copy this hook
inline; consolidating is a deferred cleanup.

## Reveal mode (CardDeck)

Click and drag in reveal mode both call **`animateCycleOut`** —
imperative helper that flies the card off to the side and commits the
cycle. Earlier state-machine refactors broke drag, so we reverted. The
`animateCycleOut` cleanup uses `transition: none` + forced reflow
(`void el.offsetHeight`) when clearing inline styles, otherwise the
outgoing card animates back in from off-screen as the JSX transition
catches the cleared values. Don't undo that.

## Draft bot tuning

`lib/draft-bot.ts`. Weights ramp from pure-rarity (early picks) to
color-locked (late picks) over picks 6–22. Three-tier color match:
in-all-colors, in-any-color (splash credit), off-color. GIH-WR
quality bump from 17Lands when available. Top-K spice picks
(85/12/3 split) with `MAX_SPICE_GAP = 1.5` so bots never blunder
mythics into commons.

## Confluence (daily connections puzzle)

`/confluence` — NYT-Connections-style daily: 16 card names, four
hidden groups of four, unique solution. Branded **Confluence** (an
actual MTG cycle name) everywhere user-visible — route, nav pill,
API path (`/api/confluence/puzzle`), localStorage keys — deliberate
distance from NYT's "Connections" mark. INTERNAL names (lib/
connections.ts, scripts/build-connections.mjs, data/connections/,
`Connections*` types) keep the descriptive genre name on purpose;
don't churn them, and don't let new user-visible surfaces say
"Connections".

- **Generator**: `npm run build:connections` →
  `scripts/build-connections.mjs` reads `data/set-cards/*.json.gz`
  and writes `data/connections/puzzles.json` (~160-board pool,
  deterministic under `--seed`). Group archetypes per board: yellow =
  hidden word theme, green = creature type | card type | exact color
  identity (guilds/shards/wedges/5c — no mono), blue = cycle or
  premier-set exclusive, purple = artist or curated lore group. Every
  group carries a computable predicate and boards are **formally
  verified to have exactly one valid partition** (exact cover over
  the 16×4 membership matrix) — red herrings survive only when the
  solution stays unique. A second **phantom scan** then rejects any
  board where ≥4 cards share a connection from the game's own
  category library (another artist, tribe, word theme, identity, …)
  that isn't one of the four intended groups — unsubmittable but
  confusing. Beyond-library associations (all legendary, all Human)
  are deliberately allowed: those are ordinary red herrings.
  Curated lists live in the script (CYCLES /
  LORE_CYCLES / WORD_THEMES / COLOR_IDENTITIES): lore groups must be
  beyond-doubt facts; wordlists have a tight `words` core (choosable)
  + broad `also` extension (verifier-only) so titles stay honest.
- **Recent tag**: the script makes ONE call to Scryfall `/sets`
  (10 req/s class, safe) to find premier expansions from the last 18
  months, generates an extra recent-only pass (~⅓ of the pool), and
  tags any board whose 16 cards all exist in that window with
  `recent: true`. Offline runs skip the call gracefully (no tags —
  the endless filter then silently serves the full pool). The
  dynamic set list also future-proofs "printed in <set>" groups for
  sets newer than the hardcoded PREMIER_SETS fallback.
- **Daily selection**: `lib/connections.ts::getDailyPuzzle` — UTC
  date → pool index from the `epoch` field; regenerating the pool
  RESHUFFLES the schedule (same-day players can see a different
  board), so regenerate deliberately, not casually.
  `data/connections/curated.json` (`byDate` keyed YYYY-MM-DD)
  overrides any date with a hand-authored board.
- **Answer secrecy**: never import `lib/connections.ts` from a client
  component (it bundles the full answer pool) — the page passes ONE
  puzzle as a prop; endless mode fetches one at a time from
  `/api/connections/puzzle`. `ConnectionsGame.tsx` uses
  `import type` only.
- **Client**: `app/confluence/ConnectionsGame.tsx`. Art-on-tiles is
  the default (casual "recognition" mode), Eye toggle → names-only
  expert mode, persisted under `mythicpulls:confluence:art-v1`.
  Endless mode adds a "New sets" pill (`recent-v1` key) that deals
  boards from `recent: true` pool entries via
  `/api/confluence/puzzle?recent=1`. Toggling it re-deals on the
  spot when the board is pristine or finished, and shows an inline
  "Deal it / Keep playing" confirm when a board is mid-solve — the
  filter must never feel like it silently does nothing. The daily
  always stays full-catalog so everyone shares one board.
  Daily progress + streak stats in `mythicpulls:confluence:*` keys
  (renamed from `:connections:` pre-launch, before any user data
  existed — immutable from now on).
  Press-and-hold on a tile opens an enlarged **art-crop** peek
  (pointer events + capture, portal overlay). Art crop ONLY — the
  full card image would leak artist, type line, and set symbol,
  i.e. three of the four group answers.
  Grid reflow is a hand-rolled FLIP (`useFlipTiles`) — transforms go
  on the button; hop/shake/selected-scale live on the inner span so
  they don't fight the FLIP's inline transforms. Tile-order shuffle
  is seeded by puzzle id so SSR html matches the client's first
  render (no spoiler flash, no hydration mismatch).
- **Hints**: `HintsPanel` sits BELOW the board (never a side rail —
  it would steal tile-grid width, i.e. art size). Three escalating
  reveals per unsolved group: archetype nudge → exact thread → one
  card (ringed on the board in the group color). Levels persist in
  the daily save blob and the total is appended to the share text
  ("· N hints") so hinted results stay honest.

## Useful entry points

- `app/_components/SiteHeader.tsx` — nav, mobile drawer, Support button
- `app/sets/[code]/PackOpener.tsx` — pack opener flow, MoneyStrip,
  PackFan, RippingPack
- `app/sealed/[code]/SealedDeckBuilder.tsx` — deck builder, shared by
  Sealed AND Draft (`mode: "sealed" | "draft"` prop changes labels)
- `app/draft/[code]/DraftRun.tsx` — 8-seat draft state machine
- `app/confluence/ConnectionsGame.tsx` — Confluence board (see above)
- `lib/scryfall.ts` — Scryfall client + `getOpenableSets`
- `lib/booster-loader.ts` — server-only recipe resolution
- `lib/draft-bot.ts` — bot pick logic
- `data/set-art.json`, `data/draft-stats/`, `data/booster-prices.json`
  — bulk-edited config / cached data
