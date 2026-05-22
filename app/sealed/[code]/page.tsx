import Link from "next/link";
import { notFound } from "next/navigation";
import { getSet, getSetCards, getSetTokens } from "@/lib/scryfall";
import type { ScryfallCard } from "@/lib/scryfall";
import { recommendedPackType, type PackType } from "@/lib/pack-rules";
import { collectReferencedSets } from "@/lib/booster-config";
import {
  loadFilters,
  packsAvailableForSet,
  resolveRecipe,
} from "@/lib/booster-loader";
import { validateSetCode } from "@/lib/safe-url";
import { SealedRun } from "./SealedRun";

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
    title: `Sealed · ${set.name} · Mythic Pulls`,
    description: `Open six ${set.name} boosters and build a 40-card sealed deck.`,
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
 * Sealed flow entry point. Mirrors the data-fetch shape of /sets/[code]
 * but only resolves the recipe for one pack type — whichever is the set's
 * "main" booster (Play for modern, Draft for legacy sets). Six packs of
 * that type get opened by the client SealedRun, and the resulting pool
 * feeds into the deckbuilder.
 */
export default async function SealedSetPage({ params }: Props) {
  const { code: raw } = await params;
  const code = validateSetCode(raw);
  if (!code) notFound();
  const set = await getSet(code);
  if (!set) notFound();

  // Pick the canonical pack type for sealed: play if supported, else draft,
  // else whatever else this set offers. We don't expose a chooser on this
  // page — sealed events use one pack type, period.
  const available = await packsAvailableForSet(set.code, set.released_at);
  const recommended = recommendedPackType(set);
  const sealedType: PackType =
    available.includes(recommended)
      ? recommended
      : available.includes("play")
        ? "play"
        : available.includes("draft")
          ? "draft"
          : available[0];

  const recipe = await resolveRecipe(set.code, sealedType);
  if (!recipe) notFound();

  // Collect every subset the recipe references and fetch them in parallel.
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

  // Pull one sample basic land per color from the main set so the deck
  // export can attribute set + collector_number to the basics the player
  // adds. Falls back to whatever Scryfall returns; if a basic isn't in
  // this set the export will just emit "<n> Plains" (Arena handles that).
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
      <div className="mx-auto max-w-7xl w-full px-6 pt-28 md:pt-32">
        <Link
          href="/sealed"
          className="label-caps text-[var(--color-ink-muted)] hover:text-[var(--color-fg)] transition-colors"
        >
          ← Pick a different set
        </Link>
        <div className="flex items-start gap-5 mt-4">
          {set.icon_svg_uri && (
            <div className="w-16 h-16 rounded-xl grid place-items-center shrink-0 liquid-panel">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={set.icon_svg_uri}
                alt=""
                className="w-9 h-9 object-contain"
                style={{ filter: "brightness(0) invert(1)" }}
              />
            </div>
          )}
          <div>
            <p className="label-caps text-[var(--color-ink-muted)]">
              SEALED · {set.code.toUpperCase()} · {set.released_at?.slice(0, 4) ?? ""}
            </p>
            <h1 className="font-display text-[2.2rem] md:text-5xl text-[var(--color-fg)] mt-2 leading-[0.95] balance">
              {set.name}
            </h1>
            <p className="text-[var(--color-ink)] mt-2">
              {mainCards.length} cards in pool · 6 {sealedType === "play" ? "Play" : sealedType === "draft" ? "Draft" : "Collector"} Boosters · 40-card minimum
            </p>
          </div>
        </div>
      </div>
      <SealedRun
        setMeta={{
          code: set.code,
          name: set.name,
          iconUri: set.icon_svg_uri,
        }}
        pool={pool}
        recipe={recipe.content}
        sealedType={sealedType}
        filters={filters}
        basicLandSamples={basicLandSamples}
      />
    </div>
  );
}
