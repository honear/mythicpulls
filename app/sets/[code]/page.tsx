import Link from "next/link";
import { notFound } from "next/navigation";
import { getSet, getSetCards } from "@/lib/scryfall";
import { packsAvailableFor, recommendedPackType } from "@/lib/pack-rules";
import { PackOpener } from "./PackOpener";

export const revalidate = 60 * 60 * 24 * 7;

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

  const cards = await getSetCards(code);
  const available = packsAvailableFor(set);
  const initial = (sp.type as "play" | "draft" | "collector") ?? recommendedPackType(set);
  const initialType = available.includes(initial) ? initial : available[0];

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
        }}
        cards={cards}
        availableTypes={available}
        initialType={initialType}
      />
    </div>
  );
}
