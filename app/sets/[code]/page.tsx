import Link from "next/link";
import { notFound } from "next/navigation";
import { getSet, getSetCards, getSetTokens } from "@/lib/scryfall";
import { packsAvailableFor, recommendedPackType } from "@/lib/pack-rules";
import { PackOpener } from "./PackOpener";

// Caching is handled at the fetch layer inside lib/scryfall.ts. A page-level
// `revalidate` export is incompatible with this route because we await
// `searchParams`, which forces dynamic rendering — Next.js 16 rejects the
// combination as an invalid segment config.

interface Props {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ type?: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { code } = await params;
  const set = await getSet(code);
  if (!set) return { title: "Set not found" };
  return {
    title: `${set.name} · Open packs · Mythic Pulls`,
    description: `Open ${set.name} (${set.code.toUpperCase()}) boosters with faithful drop rates.`,
  };
}

export default async function SetPage({ params, searchParams }: Props) {
  const { code } = await params;
  const sp = await searchParams;
  const set = await getSet(code);
  if (!set) notFound();

  const [cards, tokens] = await Promise.all([
    getSetCards(code),
    getSetTokens(code),
  ]);
  const available = packsAvailableFor(set);
  const initial = (sp.type as "play" | "draft" | "collector") ?? recommendedPackType(set);
  const initialType = available.includes(initial) ? initial : available[0];

  // Pick a handful of "hero" art crops for set branding. We prefer the
  // priciest rare/mythics whose art_crop URL is available — that gives each
  // set page its own visual signature without burning a separate API call.
  const heroArtCrops = cards
    .filter(
      (c) =>
        (c.rarity === "rare" || c.rarity === "mythic") &&
        !!c.image_uris?.art_crop,
    )
    .sort(
      (a, b) =>
        Number(b.prices?.usd ?? 0) - Number(a.prices?.usd ?? 0),
    )
    .slice(0, 6)
    .map((c) => c.image_uris!.art_crop!);

  return (
    <div className="flex flex-col">
      <div className="mx-auto max-w-7xl w-full px-6 pt-28 md:pt-32">
        <Link
          href="/"
          className="label-caps text-[var(--color-ink-muted)] hover:text-[var(--color-fg)] transition-colors"
        >
          ← All sets
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
              {set.code.toUpperCase()} · {set.released_at?.slice(0, 4) ?? ""}
            </p>
            <h1 className="font-display text-[2.2rem] md:text-6xl text-[var(--color-fg)] mt-2 leading-[0.95] balance">
              {set.name}
            </h1>
            <p className="text-[var(--color-ink)] mt-2">
              {cards.length} cards in pool · {set.set_type.replace(/_/g, " ")}
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
        cards={cards}
        tokens={tokens}
        availableTypes={available}
        initialType={initialType}
      />
    </div>
  );
}
