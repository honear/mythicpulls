"use client";

import { useState } from "react";
import { Sparkles, ArrowRight, FastForward } from "lucide-react";
import type { ScryfallCard } from "@/lib/scryfall";
import type { PackContent } from "@/lib/booster-config";
import type { FilterPredicate } from "@/lib/booster-filters";
import { openPack, type CardPool, type PulledCard } from "@/lib/pack-open";
import type { PackType } from "@/lib/pack-rules";
import { SealedPackGrid } from "./SealedPackGrid";
import { SealedDeckBuilder } from "./SealedDeckBuilder";

const TOTAL_PACKS = 6;

interface SetMeta {
  code: string;
  name: string;
  iconUri?: string;
}

interface Props {
  setMeta: SetMeta;
  pool: CardPool;
  recipe: PackContent;
  sealedType: PackType;
  filters: Record<string, FilterPredicate>;
  /** Sample basic land cards per name, used by the export to embed set
   *  codes on basic-land lines. Optional. */
  basicLandSamples: Partial<Record<string, ScryfallCard>>;
}

type Phase = "between-packs" | "revealing" | "building";

/**
 * Sealed flow controller. Walks the player through 6 packs (each one
 * revealed via SealedPackGrid — an auto-flipping grid view), accumulates
 * a single pool, then hands off to SealedDeckBuilder once all 6 packs
 * are done.
 *
 * State machine:
 *   between-packs (initial only — before pack 1 is opened)
 *     └─ "Open Pack 1 of 6" → revealing (pack 1)
 *   revealing
 *     └─ Continue button on SealedPackGrid → onPackComplete:
 *           • If <6 packs opened, rip the next pack inline, stay in
 *             revealing. The grid remounts with new pulls.
 *           • If =6 packs opened, transition to building.
 *   building (terminal)
 */
export function SealedRun({
  setMeta, pool, recipe, sealedType, filters, basicLandSamples,
}: Props) {
  const [phase, setPhase] = useState<Phase>("between-packs");
  const [packs, setPacks] = useState<PulledCard[][]>([]);
  const [currentPack, setCurrentPack] = useState<PulledCard[] | null>(null);

  const packsOpened = packs.length;
  const packNumber = phase === "revealing" ? packsOpened + 1 : packsOpened;
  const poolFlat = packs.flat();

  function ripNextPack() {
    if (packsOpened >= TOTAL_PACKS) return;
    const pulls = openPack(recipe, pool, setMeta.code, filters);
    setCurrentPack(pulls);
    setPhase("revealing");
  }

  function onPackComplete() {
    if (!currentPack) return;
    const nextPacks = [...packs, currentPack];
    setPacks(nextPacks);
    if (nextPacks.length >= TOTAL_PACKS) {
      setCurrentPack(null);
      setPhase("building");
    } else {
      // Rip the next pack inline so the Continue click advances the user in
      // one motion (no extra "Open Pack N+1" landing between every reveal).
      // SealedPackGrid sees `pulled` change and resets its stagger state.
      const nextPulls = openPack(recipe, pool, setMeta.code, filters);
      setCurrentPack(nextPulls);
    }
  }

  /**
   * Skip the reveal experience: open every remaining pack in one shot and
   * jump straight to the deck builder. Works from `between-packs` (haven't
   * cracked the current pack yet) and `revealing` (treats the current pack
   * as opened-but-unrevealed; its cards still land in the pool). Useful
   * when the player has done the reveal flow before and just wants to
   * build.
   */
  function skipToBuilder() {
    const accumulated: PulledCard[][] = [...packs];
    if (currentPack) accumulated.push(currentPack);
    while (accumulated.length < TOTAL_PACKS) {
      accumulated.push(openPack(recipe, pool, setMeta.code, filters));
    }
    setPacks(accumulated);
    setCurrentPack(null);
    setPhase("building");
  }

  if (phase === "building") {
    // Tokens have no role in deck construction — strip them out so the
    // pool the deckbuilder sees is the 84 (or so) playable cards from the
    // six packs, not 90.
    const playablePool = poolFlat.filter((p) => !p.isToken);
    return (
      <SealedDeckBuilder
        setMeta={setMeta}
        pool={playablePool}
        basicLandSamples={basicLandSamples}
      />
    );
  }

  return (
    <section className="mx-auto max-w-7xl w-full px-3 sm:px-6 py-6 sm:py-8">
      {/* Progress header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 mb-6 rounded-2xl liquid-glass">
        <div className="flex items-center gap-3">
          <Sparkles className="w-4 h-4 text-[var(--accent-purple-light)]" />
          <p
            className="text-[14px] font-semibold tracking-wide text-[var(--color-fg)]"
            style={{ fontFamily: "var(--font-ui)" }}
          >
            Pack {phase === "revealing" ? packNumber : packsOpened + 1}{" "}
            <span className="text-[var(--color-ink-muted)]">of {TOTAL_PACKS}</span>
          </p>
          <PackDots opened={packsOpened} total={TOTAL_PACKS} active={phase === "revealing"} />
        </div>
        <div className="flex items-center gap-3">
          <p
            className="label-caps text-[var(--color-ink-muted)]"
            style={{ fontFamily: "var(--font-ui)" }}
          >
            {poolFlat.length} cards collected
          </p>
          <button
            onClick={skipToBuilder}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium tracking-wide transition-colors hover:bg-white/10 border border-[var(--color-line)]"
            style={{
              color: "var(--color-ink)",
              fontFamily: "var(--font-ui)",
            }}
            aria-label="Skip remaining packs and go to deck builder"
            title="Auto-open every remaining pack and jump to the deck builder"
          >
            <FastForward className="w-3.5 h-3.5" />
            Skip to deck
          </button>
        </div>
      </div>

      <div
        className="relative rounded-2xl liquid-panel overflow-hidden"
        style={{ minHeight: 560 }}
      >
        <div
          data-deck-canvas
          className="relative min-h-[560px] sm:min-h-[680px] flex flex-col items-center justify-center px-3 sm:px-6 py-6 sm:py-10"
          style={{
            background: `
              radial-gradient(ellipse 90% 75% at 50% 45%, rgba(123, 57, 252, 0.28), rgba(123, 57, 252, 0.10) 35%, transparent 75%)
            `,
          }}
        >
          {phase === "between-packs" && (
            <BetweenPacksPanel
              packsOpened={packsOpened}
              total={TOTAL_PACKS}
              sealedType={sealedType}
              onRip={ripNextPack}
            />
          )}

          {phase === "revealing" && currentPack && (
            <SealedPackGrid
              pulled={currentPack}
              onContinue={onPackComplete}
              continueLabel={
                packsOpened + 1 >= TOTAL_PACKS
                  ? "Continue to deck builder"
                  : `Open pack ${packsOpened + 2} of ${TOTAL_PACKS}`
              }
            />
          )}
        </div>
      </div>
    </section>
  );
}

function PackDots({ opened, total, active }: { opened: number; total: number; active: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => {
        const done = i < opened;
        const current = active && i === opened;
        return (
          <span
            key={i}
            className="block rounded-full transition-all"
            style={{
              width: current ? 18 : 8,
              height: 8,
              background: done
                ? "var(--accent-purple)"
                : current
                  ? "var(--accent-purple-light)"
                  : "rgba(255,255,255,0.18)",
            }}
          />
        );
      })}
    </div>
  );
}

function BetweenPacksPanel({
  packsOpened, total, sealedType, onRip,
}: {
  packsOpened: number;
  total: number;
  sealedType: PackType;
  onRip: () => void;
}) {
  const remaining = total - packsOpened;
  const isFirst = packsOpened === 0;
  const allDone = packsOpened >= total;
  if (allDone) return null;

  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <p
        className="label-caps text-[var(--accent-purple-light)]"
        style={{ fontFamily: "var(--font-ui)" }}
      >
        {isFirst ? "Ready when you are" : `${remaining} pack${remaining === 1 ? "" : "s"} to go`}
      </p>
      <h2 className="font-display text-3xl md:text-5xl text-[var(--color-fg)] balance leading-tight">
        {isFirst ? "Crack open your first pack" : "Crack the next pack"}
      </h2>
      <p
        className="text-[15px] text-white/70 max-w-md"
        style={{ fontFamily: "var(--font-ui)" }}
      >
        Each pack auto-reveals in a grid. After all {total} packs, you&apos;ll
        move to deck construction.
      </p>
      <button
        onClick={onRip}
        className="inline-flex items-center gap-2 px-6 py-3 rounded-[10px] text-[15px] font-medium transition-all hover:brightness-110"
        style={{
          background: "var(--accent-purple)",
          color: "white",
          fontFamily: "var(--font-btn)",
          boxShadow:
            "0 12px 30px -10px var(--accent-purple-glow), inset 0 1px 0 rgba(255,255,255,0.18)",
        }}
      >
        Open pack {packsOpened + 1} of {total}
        <ArrowRight className="w-4 h-4" />
      </button>
      <p className="label-caps text-[var(--color-ink-dim)]">
        {sealedType === "play" ? "Play" : sealedType === "draft" ? "Draft" : "Collector"} Booster
      </p>
    </div>
  );
}
