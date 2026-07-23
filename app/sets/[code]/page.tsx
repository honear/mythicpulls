import Link from "next/link";
import { notFound } from "next/navigation";
import { getSet, getSetCards, getSetTokens, isComingSoonSet, trimCardPool, trimPoolLanguages } from "@/lib/scryfall";
import { ComingSoonSetPage } from "@/app/_components/ComingSoonSetPage";
import type { ScryfallCard } from "@/lib/scryfall";
import { recommendedPackType, type PackType } from "@/lib/pack-rules";
import { collectRecipeLanguages, collectReferencedSets, type PackContent } from "@/lib/booster-config";
import {
  loadFilters,
  packsAvailableForSet,
  resolveRecipe,
} from "@/lib/booster-loader";
import { validateSetCode } from "@/lib/safe-url";
import { PackOpener } from "./PackOpener";

interface Props {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ type?: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { code: raw } = await params;
  const code = validateSetCode(raw);
  if (!code) return { title: "Set not found" };
  const set = await getSet(code);
  if (!set) return { title: "Set not found" };
  return {
    title: `${set.name} · Open packs · Three Tree City`,
    description: `Open ${set.name} (${set.code.toUpperCase()}) boosters with faithful drop rates.`,
  };
}

/**
 * Fetch a sub-set's cards, including tokens. The set may legitimately not
 * exist (e.g. an old override pointing at a code Scryfall doesn't list),
 * in which case we return an empty array and let the engine's fallback
 * logic re-roll past that outcome.
 */
async function getReferencedSetCards(code: string): Promise<ScryfallCard[]> {
  try {
    if (code.startsWith("t")) {
      // Token sets — getSetTokens already handles the t<code> convention,
      // but if the recipe spelled out an explicit token-set code we still
      // want to honor it.
      const tokens = await getSetTokens(code.slice(1));
      if (tokens.length) return tokens;
      // Fall through to a normal fetch in case the set is actually a
      // first-class set whose code happens to start with t.
    }
    return await getSetCards(code);
  } catch {
    return [];
  }
}

export default async function SetPage({ params, searchParams }: Props) {
  const { code: raw } = await params;
  const code = validateSetCode(raw);
  if (!code) notFound();
  const sp = await searchParams;
  const set = await getSet(code);
  if (!set) notFound();

  // Unreleased sets in the preview window render a teaser instead of
  // the opener — no pool fetch, no recipes, packs unlock on street
  // date. See isComingSoonSet in lib/scryfall.ts.
  if (isComingSoonSet(set)) {
    return <ComingSoonSetPage set={set} backHref="/" backLabel="All sets" />;
  }

  // What pack types are valid for this set + which is the recommended
  // landing one. packsAvailableForSet combines a date-based heuristic
  // with whatever pack types the optional `data/booster-contents/
  // <setCode>.json` explicitly defines.
  const available = await packsAvailableForSet(set.code, set.released_at);
  const initial = (sp.type as PackType) ?? recommendedPackType(set);
  const initialType = available.includes(initial) ? initial : available[0];

  // Resolve recipes for every pack type up front. We need to know every
  // referenced set across every recipe so we can pre-fetch their pools
  // in parallel before handing to the client opener.
  const resolved = await Promise.all(
    available.map(async (t) => ({ type: t, recipe: await resolveRecipe(set.code, t) })),
  );

  // Collect every Scryfall set code mentioned by any outcome across any
  // pack type. The set's own code is always included.
  const referenced = new Set<string>([set.code.toLowerCase()]);
  for (const { recipe } of resolved) {
    if (!recipe) continue;
    for (const refCode of collectReferencedSets(recipe.content, set.code)) {
      referenced.add(refCode);
    }
  }

  // Fetch every referenced set's cards + the conventional tokens set. We
  // always include t<code> tokens since the default content uses
  // $tokens-sentinels.
  const setCodes = Array.from(referenced);
  const tokenCode = `t${set.code.toLowerCase()}`;
  if (!referenced.has(tokenCode)) setCodes.push(tokenCode);

  const [mainCards, ...subsetCards] = await Promise.all([
    getSetCards(set.code),
    ...setCodes
      .filter((c) => c.toLowerCase() !== set.code.toLowerCase())
      .map((c) => getReferencedSetCards(c)),
  ]);

  const pool: Record<string, ScryfallCard[]> = {
    [set.code.toLowerCase()]: mainCards,
  };
  const otherCodes = setCodes.filter((c) => c.toLowerCase() !== set.code.toLowerCase());
  otherCodes.forEach((c, i) => {
    pool[c.toLowerCase()] = subsetCards[i] ?? [];
  });

  const filters = await loadFilters();
  const recipesByType: Partial<Record<PackType, PackContent>> = {};
  const costsByType: Partial<Record<PackType, number>> = {};
  for (const { type, recipe } of resolved) {
    if (recipe) {
      recipesByType[type] = recipe.content;
      if (recipe.costUsd != null) costsByType[type] = recipe.costUsd;
    }
  }

  // Hero art (still from the main set's rare/mythics) for backdrops + the
  // pack fan.
  const heroArtCrops = mainCards
    .filter((c) => (c.rarity === "rare" || c.rarity === "mythic") && !!c.image_uris?.art_crop)
    .sort((a, b) => Number(b.prices?.usd ?? 0) - Number(a.prices?.usd ?? 0))
    .slice(0, 6)
    .map((c) => c.image_uris!.art_crop!);

  return (
    <div className="flex flex-col">
      <div className="mx-auto max-w-7xl w-full px-4 sm:px-6 pt-24 sm:pt-28 md:pt-32">
        <Link
          href="/"
          className="label-caps text-[var(--color-ink-muted)] hover:text-[var(--color-fg)] transition-colors"
        >
          ← All sets
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
              {set.code.toUpperCase()} · {set.released_at?.slice(0, 4) ?? ""}
            </p>
            <h1 className="font-display text-[1.7rem] sm:text-[2.2rem] md:text-6xl text-[var(--color-fg)] mt-1 sm:mt-2 leading-[0.95] balance">
              {set.name}
            </h1>
            <p className="text-[var(--color-ink)] mt-2">
              {mainCards.length} cards in pool · {set.set_type.replace(/_/g, " ")}
            </p>
          </div>
        </div>
      </div>
      <PackOpener
        setMeta={{
          code: set.code,
          name: set.name,
          iconUri: set.icon_svg_uri,
          heroArtCrops,
        }}
        // Two-stage trim at the server/client boundary: (1) drop every
        // non-English printing the recipes' filters can't select —
        // 60-75% of a multilingual pool, multi-MB of HTML on mobile —
        // then (2) strip each surviving card to the fields the client
        // reads. See trimPoolLanguages + trimCardForClient.
        pool={trimCardPool(
          trimPoolLanguages(
            pool,
            collectRecipeLanguages(Object.values(recipesByType), filters),
          ),
        )}
        recipes={recipesByType}
        costs={costsByType}
        filters={filters}
        availableTypes={available}
        initialType={initialType}
      />
    </div>
  );
}
