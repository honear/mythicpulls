import Link from "next/link";
import { notFound } from "next/navigation";
import { getSet, getSetCards, getSetTokens, trimCardPool, trimPoolLanguages } from "@/lib/scryfall";
import type { ScryfallCard } from "@/lib/scryfall";
import { recommendedPackType, type PackType } from "@/lib/pack-rules";
import { collectRecipeLanguages, collectReferencedSets } from "@/lib/booster-config";
import {
  loadFilters,
  packsAvailableForSet,
  resolveRecipe,
} from "@/lib/booster-loader";
import { validateSetCode } from "@/lib/safe-url";
import { setHasDraftStats } from "@/lib/draft-stats-meta";
import { DraftRun } from "./DraftRun";

interface Props {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { code: raw } = await params;
  const code = validateSetCode(raw);
  if (!code) return { title: "Set not found" };
  const set = await getSet(code);
  if (!set) return { title: "Set not found" };
  return {
    title: `Draft · ${set.name} · Three Tree City`,
    description: `Draft ${set.name} against seven AI bots and build a 40-card deck.`,
  };
}

async function getReferencedSetCards(code: string): Promise<ScryfallCard[]> {
  try {
    if (code.startsWith("t")) {
      const tokens = await getSetTokens(code.slice(1));
      if (tokens.length) return tokens;
    }
    return await getSetCards(code);
  } catch {
    return [];
  }
}

/**
 * Draft flow entry point. Mirrors the data-fetch shape of /sealed/[code]:
 * resolves the recipe for the set's canonical pack type (Play for modern,
 * Draft for legacy), pulls every referenced subset pool, and hands the
 * whole bundle to a client DraftRun.
 */
export default async function DraftSetPage({ params }: Props) {
  const { code: raw } = await params;
  const code = validateSetCode(raw);
  if (!code) notFound();
  const set = await getSet(code);
  if (!set) notFound();

  const available = await packsAvailableForSet(set.code, set.released_at);
  const recommended = recommendedPackType(set);
  // Booster Draft historically used Draft Boosters; modern sealed/draft uses
  // Play. Pick whichever is most canonical for the era, falling back if the
  // chosen type doesn't have a recipe.
  const draftType: PackType =
    available.includes(recommended)
      ? recommended
      : available.includes("draft")
        ? "draft"
        : available.includes("play")
          ? "play"
          : available[0];

  const recipe = await resolveRecipe(set.code, draftType);
  if (!recipe) notFound();

  const referenced = new Set<string>([set.code.toLowerCase()]);
  for (const c of collectReferencedSets(recipe.content, set.code)) {
    referenced.add(c);
  }
  const tokenCode = `t${set.code.toLowerCase()}`;
  if (!referenced.has(tokenCode)) referenced.add(tokenCode);

  const otherCodes = Array.from(referenced).filter(
    (c) => c.toLowerCase() !== set.code.toLowerCase(),
  );
  const [mainCards, ...subsetCards] = await Promise.all([
    getSetCards(set.code),
    ...otherCodes.map((c) => getReferencedSetCards(c)),
  ]);

  const pool: Record<string, ScryfallCard[]> = {
    [set.code.toLowerCase()]: mainCards,
  };
  otherCodes.forEach((c, i) => {
    pool[c.toLowerCase()] = subsetCards[i] ?? [];
  });

  const filters = await loadFilters();

  // Sample basic lands per name — used by the deck builder's export step
  // to attribute set + collector number on basic-land lines.
  const basicLandSamples: Partial<Record<string, ScryfallCard>> = {};
  const BASIC_NAMES = ["Plains", "Island", "Swamp", "Mountain", "Forest"];
  for (const c of mainCards) {
    const tl = (c.type_line ?? "").toLowerCase();
    if (!tl.includes("basic land")) continue;
    const matched = BASIC_NAMES.find((n) => c.name === n);
    if (matched && !basicLandSamples[matched]) basicLandSamples[matched] = c;
  }

  return (
    <div className="flex flex-col">
      <div className="mx-auto max-w-7xl w-full px-4 sm:px-6 pt-24 sm:pt-28 md:pt-32">
        <Link
          href="/draft"
          className="label-caps text-[var(--color-ink-muted)] hover:text-[var(--color-fg)] transition-colors"
        >
          ← Pick a different set
        </Link>
        <div className="flex items-start gap-3 sm:gap-5 mt-3 sm:mt-4">
          {set.icon_svg_uri && (
            <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-xl grid place-items-center shrink-0 liquid-panel">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={set.icon_svg_uri}
                alt=""
                className="w-7 h-7 sm:w-9 sm:h-9 object-contain"
                style={{ filter: "brightness(0) invert(1)" }}
              />
            </div>
          )}
          <div className="min-w-0">
            <p className="label-caps text-[var(--color-ink-muted)]">
              DRAFT · {set.code.toUpperCase()} · {set.released_at?.slice(0, 4) ?? ""}
            </p>
            <h1 className="font-display text-[1.7rem] sm:text-[2.2rem] md:text-5xl text-[var(--color-fg)] mt-1 sm:mt-2 leading-[0.95] balance">
              {set.name}
            </h1>
            <p className="text-[var(--color-ink)] mt-2">
              {mainCards.length} cards in pool · 3 packs × 8 seats · 40-card minimum deck
            </p>
            {setHasDraftStats(set.code) && (
              <p
                className="mt-3 text-[12px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full"
                style={{
                  background: "rgba(123,57,252,0.18)",
                  border: "1px solid rgba(164,132,215,0.35)",
                  color: "var(--accent-purple-light)",
                  fontFamily: "var(--font-ui)",
                }}
              >
                Card pick data retrieved from{" "}
                <a
                  href={`https://www.17lands.com/card_data?expansion=${set.code.toUpperCase()}&format=PremierDraft`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-dotted underline-offset-4 hover:text-white"
                >
                  17Lands
                </a>
              </p>
            )}
          </div>
        </div>
      </div>
      <DraftRun
        setMeta={{
          code: set.code,
          name: set.name,
          iconUri: set.icon_svg_uri,
        }}
        // Language-trim (drop printings no filter can select), then
        // field-trim before hydration — see trimPoolLanguages +
        // trimCardForClient in lib/scryfall.ts.
        pool={trimCardPool(
          trimPoolLanguages(pool, collectRecipeLanguages([recipe.content], filters)),
        )}
        recipe={recipe.content}
        draftType={draftType}
        filters={filters}
        basicLandSamples={basicLandSamples}
      />
    </div>
  );
}
