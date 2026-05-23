"use client";

import { useMemo, useState } from "react";
import { FastForward, Sparkles } from "lucide-react";
import type { ScryfallCard } from "@/lib/scryfall";
import type { PackContent } from "@/lib/booster-config";
import type { FilterPredicate } from "@/lib/booster-filters";
import { openPack, type CardPool, type PulledCard } from "@/lib/pack-open";
import type { PackType } from "@/lib/pack-rules";
import { botPick } from "@/lib/draft-bot";
import { SealedDeckBuilder } from "@/app/sealed/[code]/SealedDeckBuilder";
import { DraftTable, type SeatInfo } from "./DraftTable";
import { DraftPickPanel } from "./DraftPickPanel";

const TOTAL_SEATS = 8;
const TOTAL_ROUNDS = 3;
const USER_SEAT = 0;

/* ===========================================================================
   DraftRun
   ---------------------------------------------------------------------------
   State machine for an 8-seat Booster Draft:

     idle (no packs yet)
       └─ "Start drafting" → opens 8 fresh packs, advances to round 1
     round-N-picking
       ├─ User picks a card from packs[0]
       │   • bots simultaneously pick from their own packs (lib/draft-bot)
       │   • packs lose their picked card, then rotate one seat
       │     (round 1+3: left = rotate array left; round 2: right)
       ├─ When every pack is empty → next round or finish
     done
       └─ Mounts SealedDeckBuilder with the user's pool (~45 cards)

   The bots are anonymous "Seat 2..8". The user is "You" at seat 0. Every
   bot has its own evolving pool which feeds back into its next pick via
   the bot scoring (so signals develop organically over the draft).
   =========================================================================== */

interface SetMeta {
  code: string;
  name: string;
  iconUri?: string;
}

interface Props {
  setMeta: SetMeta;
  pool: CardPool;
  recipe: PackContent;
  draftType: PackType;
  filters: Record<string, FilterPredicate>;
  basicLandSamples: Partial<Record<string, ScryfallCard>>;
}

type Phase = "idle" | "picking" | "done";

interface Seat {
  pool: PulledCard[];
}

export function DraftRun({
  setMeta, pool, recipe, draftType, filters, basicLandSamples,
}: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [seats, setSeats] = useState<Seat[]>(() =>
    Array.from({ length: TOTAL_SEATS }, () => ({ pool: [] })),
  );
  /** packs[i] = the pack currently in front of seat i. Empty arrays mean
   *  that seat's pack is exhausted (everyone's exhausts together in lockstep). */
  const [packs, setPacks] = useState<PulledCard[][]>(() =>
    Array.from({ length: TOTAL_SEATS }, () => []),
  );
  const [round, setRound] = useState<number>(0);
  /** Pick number within the current round, 1-indexed. */
  const [pickNumber, setPickNumber] = useState<number>(0);

  /**
   * In-flight pick. While set, the panel renders `prevPack` (the user's
   * pack as it looked *before* the pick) with exit animations: every card
   * staggers out in the pass direction and the picked card lifts up +
   * fades. After ~280ms the state commits, `transition` clears, and the
   * panel mounts the new pack which enters from the opposite side.
   */
  const [transition, setTransition] = useState<{
    prevPack: PulledCard[];
    pickedUid: string;
    direction: "left" | "right";
  } | null>(null);

  const passDirection: "left" | "right" = round === 2 ? "right" : "left";

  /* ============================================================
     Pack lifecycle helpers
     ============================================================ */

  /** Open 8 fresh packs (one per seat), strip tokens since tokens aren't
   *  drafted. Returns the new packs array. */
  function openRoundPacks(): PulledCard[][] {
    const out: PulledCard[][] = [];
    for (let s = 0; s < TOTAL_SEATS; s++) {
      const pulls = openPack(recipe, pool, setMeta.code, filters)
        .filter((p) => !p.isToken);
      out.push(pulls);
    }
    return out;
  }

  function startDrafting() {
    const r1 = openRoundPacks();
    setPacks(r1);
    setRound(1);
    setPickNumber(1);
    setPhase("picking");
  }

  function rotatePacks(list: PulledCard[][], dir: "left" | "right"): PulledCard[][] {
    if (dir === "left") {
      // Pack at seat i moves to seat i-1 (mod 8). Equivalent: newList[i] = list[(i+1) % N].
      return list.map((_, i) => list[(i + 1) % list.length]);
    }
    // Pass right: newList[i] = list[(i - 1 + N) % N].
    return list.map((_, i) => list[(i - 1 + list.length) % list.length]);
  }

  /* ============================================================
     Pick step — runs when the user picks a card.
     Bots pick simultaneously from their current packs, then packs
     are pruned and rotated.
     ============================================================ */

  /** Public click handler — kicks off the exit animation, then defers the
   *  actual state update until the animation has played. Re-entrant clicks
   *  during the animation are dropped (the panel disables clicks too). */
  function onUserPickClick(uid: string) {
    if (transition || phase !== "picking") return;
    const userPack = packs[USER_SEAT];
    if (!userPack.find((p) => p.uid === uid)) return;
    setTransition({
      prevPack: userPack,
      pickedUid: uid,
      direction: passDirection,
    });
    // Wait long enough for the highest-jittered card to finish its exit
    // before remounting the panel with the new pack. The exit keyframe
    // runs 380ms; jitter is 0–120ms; we add 20ms of slack so even the
    // slowest card has fully faded before unmount, otherwise the panel
    // looks like it freezes (the previous timing cut mid-animation).
    window.setTimeout(() => {
      processPick(uid);
      setTransition(null);
    }, 520);
  }

  function processPick(userPickUid: string) {
    if (phase !== "picking") return;
    const userPack = packs[USER_SEAT];
    const userPicked = userPack.find((p) => p.uid === userPickUid);
    if (!userPicked) return;

    // 1. Bots pick (each from its current pack, using its current pool).
    //    The user's pick is also computed here for parallelism.
    const newPools: PulledCard[][] = seats.map((seat, i) => {
      if (i === USER_SEAT) return [...seat.pool, userPicked];
      const myPack = packs[i];
      if (myPack.length === 0) return seat.pool;
      const chosen = botPick(myPack, seat.pool);
      return [...seat.pool, chosen];
    });

    // 2. Remove the picked cards from each pack.
    const trimmedPacks: PulledCard[][] = packs.map((pack, i) => {
      if (i === USER_SEAT) {
        return pack.filter((p) => p.uid !== userPicked.uid);
      }
      // Bot's pick is the last card added to its pool this turn.
      const newPool = newPools[i];
      const justPicked = newPool[newPool.length - 1];
      if (!justPicked) return pack;
      return pack.filter((p) => p.uid !== justPicked.uid);
    });

    const nextSeats = newPools.map((pl) => ({ pool: pl }));

    // 3. Check if every pack is now empty — end of round.
    if (trimmedPacks.every((p) => p.length === 0)) {
      if (round >= TOTAL_ROUNDS) {
        // Draft complete.
        setSeats(nextSeats);
        setPacks(trimmedPacks);
        setPhase("done");
        return;
      }
      // Start the next round with fresh packs.
      const nextRoundPacks = openRoundPacks();
      setSeats(nextSeats);
      setPacks(nextRoundPacks);
      setRound(round + 1);
      setPickNumber(1);
      return;
    }

    // 4. Otherwise, rotate the packs and continue.
    const rotated = rotatePacks(trimmedPacks, passDirection);
    setSeats(nextSeats);
    setPacks(rotated);
    setPickNumber(pickNumber + 1);
  }

  /* ============================================================
     Skip — auto-finish the rest of the draft.
     Bots pick for the user too (just like any other seat). Useful for
     replay sessions or when the player wants to inspect what they'd
     have ended up with.
     ============================================================ */
  function skipDraft() {
    let curSeats = seats.map((s) => ({ pool: [...s.pool] }));
    let curPacks = packs.map((p) => [...p]);
    let curRound = round;
    let curDir = passDirection;
    // Hard cap iteration count — should never trigger but protects
    // against infinite loops if pack data is malformed.
    let guard = TOTAL_SEATS * TOTAL_ROUNDS * 30;

    while (guard-- > 0) {
      // If all packs empty, advance round or finish.
      if (curPacks.every((p) => p.length === 0)) {
        if (curRound >= TOTAL_ROUNDS) {
          setSeats(curSeats);
          setPacks(curPacks);
          setRound(curRound);
          setPhase("done");
          return;
        }
        curRound += 1;
        curDir = curRound === 2 ? "right" : "left";
        curPacks = openRoundPacks();
        continue;
      }
      // Every seat (including the user) picks via the bot scorer.
      for (let i = 0; i < TOTAL_SEATS; i++) {
        const pack = curPacks[i];
        if (pack.length === 0) continue;
        const chosen = botPick(pack, curSeats[i].pool);
        curSeats[i] = { pool: [...curSeats[i].pool, chosen] };
        curPacks[i] = pack.filter((p) => p.uid !== chosen.uid);
      }
      curPacks = rotatePacks(curPacks, curDir);
    }
    // Safety fallthrough — should never hit.
    setSeats(curSeats);
    setPacks(curPacks);
    setPhase("done");
  }

  /* ============================================================
     Derived state for rendering.
     ============================================================ */

  const seatInfos: SeatInfo[] = useMemo(
    () => seats.map((s, i) => ({
      name: i === USER_SEAT ? "You" : `Seat ${i + 1}`,
      isBot: i !== USER_SEAT,
      poolSize: s.pool.length,
    })),
    [seats],
  );

  /* ============================================================
     Render — pick panel on top, live deck builder below.
     The SealedDeckBuilder stays mounted from the moment the first
     pick happens through the end of the draft so its inDeck /
     overrides / lands state persists across the picking → done
     transition. The user can pre-build the deck while still drafting.
     ============================================================ */
  const userPack = packs[USER_SEAT] ?? [];
  const totalPickInRound = pickNumber > 0 ? pickNumber : 1;
  const userPool = seats[USER_SEAT].pool;
  const showDeckBuilder = phase !== "idle";

  return (
    <section className="mx-auto max-w-7xl w-full px-3 sm:px-6 py-6 sm:py-8 flex flex-col gap-5">
      {phase !== "done" && (
        <>
          <DraftTable
            seats={seatInfos}
            passDirection={passDirection}
            round={Math.max(round, 1)}
            totalRounds={TOTAL_ROUNDS}
          />

          {/* Status + skip-to-deck bar. Matches the sealed run's header
              bar so the affordances feel parallel: a liquid-glass surface
              frames pick progress on the left and the auto-finish escape
              hatch on the right. Previously this row had no surface and
              the skip button was easy to miss — moving both into the
              liquid-glass pill draws the eye to it. */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-2xl liquid-glass">
            <div className="flex items-center gap-3">
              <Sparkles className="w-4 h-4 text-[var(--accent-purple-light)]" />
              <p
                className="text-[14px] font-semibold tracking-wide text-[var(--color-fg)]"
                style={{ fontFamily: "var(--font-ui)" }}
              >
                {phase === "idle"
                  ? `Ready to draft · ${draftTypeName(draftType)} Booster`
                  : (
                      <>
                        Pick {totalPickInRound}
                        <span className="text-[var(--color-ink-muted)]">
                          {" · "}
                          {userPack.length} card{userPack.length === 1 ? "" : "s"} in pack · {userPool.length} drafted
                        </span>
                      </>
                    )}
              </p>
            </div>
            {phase === "picking" && (
              <button
                onClick={skipDraft}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium tracking-wide transition-colors hover:bg-white/10 border border-[var(--color-line)]"
                style={{ color: "var(--color-ink)", fontFamily: "var(--font-ui)" }}
                aria-label="Skip remaining picks and go to deck builder"
                title="Let the bots finish the draft for you and jump to the deck builder"
              >
                <FastForward className="w-3.5 h-3.5" />
                Skip to deck
              </button>
            )}
          </div>

          <div
            className="relative rounded-2xl liquid-panel overflow-hidden"
            style={{ minHeight: 540 }}
          >
            <div
              className="relative min-h-[540px] flex flex-col items-center justify-center px-3 sm:px-6 py-6 sm:py-8"
              style={{
                background: `
                  radial-gradient(ellipse 90% 75% at 50% 45%, rgba(123, 57, 252, 0.22), rgba(123, 57, 252, 0.08) 40%, transparent 75%)
                `,
              }}
            >
              {phase === "idle" && (
                <StartPanel setName={setMeta.name} onStart={startDrafting} />
              )}
              {phase === "picking" && (
                <DraftPickPanel
                  key={transition ? "exit" : `enter-${round}-${pickNumber}`}
                  pack={transition ? transition.prevPack : userPack}
                  onPick={onUserPickClick}
                  mode={transition ? "exit" : "enter"}
                  exitDirection={transition ? transition.direction : passDirection}
                  pickedUid={transition?.pickedUid}
                  hint={`Pack ${round} · Pick ${totalPickInRound} · click a card to take it`}
                />
              )}
            </div>
          </div>
        </>
      )}

      {/* Live deck builder — mounted once we've started picking, stays
          mounted through the end of the draft so its state survives the
          transition. During drafting, every pick lands in the pool here
          and the user can drag cards into the deck as they go. */}
      {showDeckBuilder && (
        <div className={phase === "picking" ? "mt-3" : ""}>
          {phase === "picking" && (
            <p
              className="label-caps text-[var(--accent-purple-light)] mb-2 px-1"
              style={{ fontFamily: "var(--font-ui)" }}
            >
              Build as you draft — your picks land in the pool below
            </p>
          )}
          <SealedDeckBuilder
            setMeta={setMeta}
            pool={userPool}
            basicLandSamples={basicLandSamples}
          />
        </div>
      )}
    </section>
  );
}

/* ============================================================
   Start panel — between "/draft/[code]" landing and the first pick.
   ============================================================ */

function StartPanel({
  setName, onStart,
}: { setName: string; onStart: () => void }) {
  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <p
        className="label-caps text-[var(--accent-purple-light)]"
        style={{ fontFamily: "var(--font-ui)" }}
      >
        Booster draft — 1 v 7 bots
      </p>
      <h2 className="font-display text-3xl md:text-5xl text-[var(--color-fg)] balance leading-tight">
        Take your seat at the {setName} table
      </h2>
      <p
        className="text-[15px] text-white/70 max-w-md"
        style={{ fontFamily: "var(--font-ui)" }}
      >
        Three packs, eight seats, ~45 picks. Pack 1 passes left, pack 2 right,
        pack 3 left. When you&apos;re done, build a 40-card deck from your picks.
      </p>
      <button
        onClick={onStart}
        className="inline-flex items-center gap-2 px-6 py-3 rounded-[10px] text-[15px] font-medium transition-all hover:brightness-110"
        style={{
          background: "var(--accent-purple)",
          color: "white",
          fontFamily: "var(--font-btn)",
          boxShadow:
            "0 12px 30px -10px var(--accent-purple-glow), inset 0 1px 0 rgba(255,255,255,0.18)",
        }}
      >
        Start drafting
      </button>
    </div>
  );
}

function draftTypeName(t: PackType): string {
  return t === "play" ? "Play" : t === "draft" ? "Draft" : "Collector";
}
