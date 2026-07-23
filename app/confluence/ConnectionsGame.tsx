"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, Eye, EyeOff, Infinity as InfinityIcon, Share2, Shuffle, Sparkles } from "lucide-react";
// Type-only import — MUST stay `import type`. lib/connections.ts pulls
// in the full puzzle pool (every answer, ~600KB); a value import here
// would ship all of it to the client. Types erase at compile time.
import type { ConnectionsPuzzle } from "@/lib/connections";

/**
 * Confluence game board. NYT-Connections mechanics: pick 4 tiles,
 * submit, 4 mistakes allowed, "one away" hint on 3/4 matches. Solved
 * groups collapse into colored rows that reveal the four card ART
 * CROPS — the payoff a word game can't offer.
 *
 * Two modes:
 *   daily   — the server-rendered board for today (prop). Progress is
 *             persisted per-date so a refresh mid-solve resumes, and
 *             finishing feeds the streak stats.
 *   endless — random boards fetched one at a time from
 *             /api/confluence/puzzle. No persistence, no stats.
 *
 * Art toggle: tiles show the card's art crop by default ("recognition
 * mode" — approachable for casual players, and makes artist groups
 * solvable by eye). Toggling it off gives the names-only expert game.
 *
 * Motion: tiles FLIP-animate to their new grid slots on shuffle and
 * after a solve; a correct guess "hops" the four tiles NYT-style
 * before they collapse into the colored row. All hand-rolled — no
 * animation library, matching the house style (see CardDeck).
 *
 * localStorage keys keep the legacy `mythicpulls:` prefix per the
 * repo-wide rule (renaming the prefix would orphan every user's data).
 */

// Keys were renamed connections→confluence pre-launch (nothing shipped,
// so no user data existed to orphan). From here on they're immutable
// identifiers like every other mythicpulls: key.
const STATE_KEY = "mythicpulls:confluence:daily-v1";
const STATS_KEY = "mythicpulls:confluence:stats-v1";
const ART_KEY = "mythicpulls:confluence:art-v1";
const RECENT_KEY = "mythicpulls:confluence:recent-v1";

/** Difficulty → tile/row colors + share emoji. Hues follow the NYT
 *  convention (players' muscle memory) but tuned for the dark theme. */
const DIFF = [
  { bg: "#e9c94a", emoji: "🟨", label: "yellow" },
  { bg: "#85b567", emoji: "🟩", label: "green" },
  { bg: "#74a2dd", emoji: "🟦", label: "blue" },
  { bg: "#af7fd9", emoji: "🟪", label: "purple" },
] as const;

const INK = "#191026"; // dark text on the group colors

/** Tier-1 hint per archetype (derived from the group key's prefix):
 *  says what KIND of thread it is without naming it. Curated boards
 *  may omit keys → generic fallback. */
const NUDGES: Record<string, string> = {
  word: "Four names hide words from one theme.",
  type: "Four creatures share a tribe — their names won't say it.",
  cardtype: "Four cards share a card type (and it isn't Creature).",
  color: "Four cards share an exact color identity.",
  cycle: "Four cards belong to one famous printed cycle.",
  set: "Four cards were all printed in the same set.",
  artist: "One illustrator painted four of these.",
  lore: "Four cards are bound together by the story.",
};

function nudgeFor(key: string | undefined): string {
  const prefix = key?.split(":")[0] ?? "";
  return NUDGES[prefix] ?? "These four share something deeper.";
}

/** How long the win-hop plays before the tiles collapse into the row. */
const SOLVE_COMMIT_MS = 720;

/** Press-and-hold delay before the art peek opens, and the movement
 *  slop (px) that cancels it — a finger that moves that far before
 *  the timer fires is scrolling, not peeking. */
const PEEK_HOLD_MS = 350;
const PEEK_SLOP_PX = 8;

/* Seeded shuffle (fnv1a → mulberry32) so the server-rendered tile
 * order matches the client's first render exactly — no hydration
 * mismatch, and no flash of group-ordered (= spoiler-ordered) tiles. */
function seededOrder(names: string[], seedStr: string): string[] {
  let h = 0x811c9dc5;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let a = h >>> 0;
  const rand = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = names.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface Stats {
  played: number;
  won: number;
  streak: number;
  maxStreak: number;
  lastFinishedDate?: string;
  lastWonDate?: string;
}

function readStats(): Stats {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw) return { played: 0, won: 0, streak: 0, maxStreak: 0, ...JSON.parse(raw) };
  } catch {
    /* corrupted stats are not worth crashing over */
  }
  return { played: 0, won: 0, streak: 0, maxStreak: 0 };
}

function prevUtcDate(dateUtc: string): string {
  return new Date(Date.parse(`${dateUtc}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * FLIP reflow for the tile grid: whenever a tile's grid slot moves
 * (shuffle, a solved group collapsing, the art toggle resizing rows),
 * play the move as a transform from its old rect instead of teleporting.
 * `resetKey` clears the measurement cache when a NEW board mounts so a
 * reused card name doesn't animate in from its previous board's slot.
 */
function useFlipTiles(resetKey: string) {
  const els = useRef(new Map<string, HTMLElement>());
  const prevRects = useRef(new Map<string, DOMRect>());
  const lastReset = useRef(resetKey);

  useLayoutEffect(() => {
    if (lastReset.current !== resetKey) {
      lastReset.current = resetKey;
      prevRects.current = new Map();
    }
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, DOMRect>();
    for (const [key, el] of els.current) {
      const rect = el.getBoundingClientRect();
      next.set(key, rect);
      const prev = prevRects.current.get(key);
      if (!reduce && prev && (Math.abs(prev.left - rect.left) > 1 || Math.abs(prev.top - rect.top) > 1)) {
        const dx = prev.left - rect.left;
        const dy = prev.top - rect.top;
        // Invert to the old position, force a reflow so the browser
        // commits it, then transition back to identity. The forced
        // reflow (`void offsetHeight`) is the same trick CardDeck's
        // animateCycleOut cleanup relies on.
        el.style.transition = "none";
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        void el.offsetHeight;
        el.style.transition = "transform 340ms cubic-bezier(0.22, 1, 0.36, 1)";
        el.style.transform = "";
      }
    }
    prevRects.current = next;
  });

  return (name: string) => (el: HTMLElement | null) => {
    if (el) els.current.set(name, el);
    else els.current.delete(name);
  };
}

export function ConnectionsGame({
  initialPuzzle,
  puzzleNumber,
  dateUtc,
}: {
  initialPuzzle: ConnectionsPuzzle;
  puzzleNumber: number;
  dateUtc: string;
}) {
  const [mode, setMode] = useState<"daily" | "endless">("daily");
  const [endlessPuzzle, setEndlessPuzzle] = useState<ConnectionsPuzzle | null>(null);
  const [fetching, setFetching] = useState(false);
  const puzzle = mode === "daily" ? initialPuzzle : endlessPuzzle;

  const [guesses, setGuesses] = useState<string[][]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  /** Hint escalation per group index: 0 none → 1 nudge → 2 thread
   *  named → 3 one card revealed (ringed on the board). Counted into
   *  the shared result so hint-assisted solves stay honest. */
  const [hintLevels, setHintLevels] = useState<Record<number, number>>({});
  /** Names of a just-correct guess playing their hop before the state
   *  commit collapses them into a row. Input is locked meanwhile. */
  const [pendingSolve, setPendingSolve] = useState<string[] | null>(null);
  /** Enlarged art-crop overlay from press-and-holding a tile (the
   *  phone tiles are small — this is the "let me actually look at it"
   *  affordance). Open while the finger is down; release closes. */
  const [peek, setPeek] = useState<{ name: string; art: string } | null>(null);
  const [artMode, setArtMode] = useState(true);
  /** Endless-only: deal boards built entirely from recent premier
   *  sets. Toggling re-deals immediately when nothing is at stake;
   *  mid-board it asks first (see confirmRedeal). */
  const [recentOnly, setRecentOnly] = useState(false);
  /** Set while the "re-deal with the new filter?" prompt is showing —
   *  only reached by toggling New-sets with a board in progress. */
  const [confirmRedeal, setConfirmRedeal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const solveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** True when a peek opened during the current press — the click that
   *  fires on release must NOT toggle selection. */
  const peekShownRef = useRef(false);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);

  /* ---- derived game state (everything flows from `guesses`) ---- */

  const groupOf = useMemo(() => {
    const m = new Map<string, number>();
    puzzle?.groups.forEach((g, gi) => g.cards.forEach((c) => m.set(c.name, gi)));
    return m;
  }, [puzzle]);

  const cardByName = useMemo(() => {
    const m = new Map<string, ConnectionsPuzzle["groups"][number]["cards"][number]>();
    puzzle?.groups.forEach((g) => g.cards.forEach((c) => m.set(c.name, c)));
    return m;
  }, [puzzle]);

  const solvedOrder = useMemo(() => {
    const out: number[] = [];
    for (const guess of guesses) {
      const gis = guess.map((n) => groupOf.get(n));
      if (gis.every((g) => g !== undefined && g === gis[0])) out.push(gis[0] as number);
    }
    return out;
  }, [guesses, groupOf]);

  const mistakes = guesses.length - solvedOrder.length;
  const status: "playing" | "won" | "lost" =
    solvedOrder.length === 4 ? "won" : mistakes >= 4 ? "lost" : "playing";
  const locked = status !== "playing" || pendingSolve !== null;

  const [order, setOrder] = useState<string[]>(() =>
    seededOrder([...initialPuzzle.groups.flatMap((g) => g.cards.map((c) => c.name))], initialPuzzle.id),
  );

  const solvedNames = useMemo(() => {
    const s = new Set<string>();
    for (const gi of solvedOrder) puzzle?.groups[gi].cards.forEach((c) => s.add(c.name));
    return s;
  }, [solvedOrder, puzzle]);

  const remaining = order.filter((n) => !solvedNames.has(n));

  const boardKey = `${mode}:${puzzle?.id ?? "none"}`;
  const flipRef = useFlipTiles(boardKey);

  /* ---- persistence: restore today's daily + prefs on mount ---- */

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as {
          date?: string;
          puzzleId?: string;
          guesses?: string[][];
          hints?: Record<number, number>;
        };
        if (saved.date === dateUtc && saved.puzzleId === initialPuzzle.id && Array.isArray(saved.guesses)) {
          setGuesses(saved.guesses.filter((g) => Array.isArray(g)));
          if (saved.hints && typeof saved.hints === "object") setHintLevels(saved.hints);
        }
      }
    } catch {
      /* unreadable save — start fresh */
    }
    try {
      if (localStorage.getItem(ART_KEY) === "off") setArtMode(false);
      if (localStorage.getItem(RECENT_KEY) === "on") setRecentOnly(true);
    } catch {
      /* defaults stay */
    }
    setStats(readStats());
    // Mount-only: dateUtc + puzzle id are fixed for the page's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mode !== "daily") return;
    try {
      localStorage.setItem(
        STATE_KEY,
        JSON.stringify({ date: dateUtc, puzzleId: initialPuzzle.id, guesses, hints: hintLevels }),
      );
    } catch {
      /* storage full/blocked — play on without saves */
    }
  }, [guesses, hintLevels, mode, dateUtc, initialPuzzle.id]);

  // Clear any in-flight timers if the component unmounts mid-animation.
  useEffect(
    () => () => {
      clearTimeout(toastTimer.current);
      clearTimeout(solveTimer.current);
      clearTimeout(peekTimer.current);
    },
    [],
  );

  /* ---- stats: record one finish per UTC date ---- */

  useEffect(() => {
    if (mode !== "daily" || status === "playing") return;
    const s = readStats();
    if (s.lastFinishedDate === dateUtc) {
      setStats(s);
      return;
    }
    const next: Stats = { ...s, played: s.played + 1, lastFinishedDate: dateUtc };
    if (status === "won") {
      next.won = s.won + 1;
      next.streak = s.lastWonDate === prevUtcDate(dateUtc) ? s.streak + 1 : 1;
      next.maxStreak = Math.max(next.streak, s.maxStreak);
      next.lastWonDate = dateUtc;
    } else {
      next.streak = 0;
    }
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    setStats(next);
  }, [status, mode, dateUtc]);

  /* ---- actions ---- */

  function showToast(msg: string) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }

  function toggleTile(name: string) {
    if (locked) return;
    setSelected((sel) =>
      sel.includes(name) ? sel.filter((n) => n !== name) : sel.length < 4 ? [...sel, name] : sel,
    );
  }

  /* Press-and-hold art peek. Pointer events with capture: capture
   * keeps pointerup routed to the tile even when the finger drifts,
   * and the browser fires pointercancel if it claims the gesture for
   * scrolling. Movement past the slop BEFORE the timer fires means
   * scroll intent — cancel quietly. */

  function startPeek(name: string, e: React.PointerEvent<HTMLButtonElement>) {
    if (!artMode || locked) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events in tests carry uncapturable pointerIds */
    }
    pressOrigin.current = { x: e.clientX, y: e.clientY };
    clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => {
      const card = cardByName.get(name);
      if (card) {
        peekShownRef.current = true;
        setPeek({ name, art: card.art });
      }
    }, PEEK_HOLD_MS);
  }

  function movePeek(e: React.PointerEvent) {
    if (!pressOrigin.current || peek) return;
    const dx = e.clientX - pressOrigin.current.x;
    const dy = e.clientY - pressOrigin.current.y;
    if (Math.hypot(dx, dy) > PEEK_SLOP_PX) {
      clearTimeout(peekTimer.current);
      pressOrigin.current = null;
    }
  }

  function endPeek() {
    clearTimeout(peekTimer.current);
    pressOrigin.current = null;
    setPeek(null);
  }

  function toggleArt() {
    setArtMode((v) => {
      try {
        localStorage.setItem(ART_KEY, v ? "off" : "on");
      } catch {
        /* ignore */
      }
      return !v;
    });
  }

  function toggleRecent() {
    const next = !recentOnly;
    setRecentOnly(next);
    try {
      localStorage.setItem(RECENT_KEY, next ? "on" : "off");
    } catch {
      /* ignore */
    }
    if (mode !== "endless") return;
    // The filter only affects which boards get DEALT — so make the
    // toggle feel real: re-deal on the spot unless that would throw
    // away a board mid-solve, in which case ask.
    if (status === "playing" && guesses.length > 0) {
      setConfirmRedeal(true);
    } else {
      setConfirmRedeal(false);
      void loadEndless(next);
    }
  }

  function submit() {
    if (selected.length !== 4 || locked || !puzzle) return;
    const key = selected.slice().sort().join("|");
    if (guesses.some((g) => g.slice().sort().join("|") === key)) {
      showToast("Already guessed");
      return;
    }
    const gis = selected.map((n) => groupOf.get(n) ?? -1);
    const counts = new Map<number, number>();
    for (const gi of gis) counts.set(gi, (counts.get(gi) ?? 0) + 1);
    const best = Math.max(...counts.values());

    if (best === 4) {
      // Correct: let the hop play out, THEN commit the guess so the
      // tiles collapse into the colored row (which rises in) and the
      // survivors FLIP to their new slots.
      const names = selected;
      setPendingSolve(names);
      clearTimeout(solveTimer.current);
      solveTimer.current = setTimeout(() => {
        setGuesses((g) => [...g, names]);
        setSelected([]);
        setPendingSolve(null);
      }, SOLVE_COMMIT_MS);
    } else {
      setGuesses((g) => [...g, selected]);
      if (best === 3) showToast("One away!");
      setShaking(true);
      setTimeout(() => setShaking(false), 400);
    }
  }

  function shuffleRemaining() {
    if (locked) return;
    setOrder((o) => {
      const rest = o.filter((n) => !solvedNames.has(n));
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      return [...o.filter((n) => solvedNames.has(n)), ...rest];
    });
  }

  /** `recentOverride` lets toggleRecent deal with the JUST-set filter
   *  value — the state update hasn't flushed into this closure yet. */
  async function loadEndless(recentOverride?: boolean) {
    if (fetching) return;
    setFetching(true);
    setConfirmRedeal(false);
    try {
      const exclude = puzzle?.id ?? initialPuzzle.id;
      const wantRecent = recentOverride ?? recentOnly;
      const res = await fetch(
        `/api/confluence/puzzle?exclude=${encodeURIComponent(exclude)}${wantRecent ? "&recent=1" : ""}`,
      );
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as ConnectionsPuzzle;
      clearTimeout(solveTimer.current);
      setPendingSolve(null);
      endPeek();
      setEndlessPuzzle(next);
      setMode("endless");
      setGuesses([]);
      setSelected([]);
      setHintLevels({});
      setOrder(seededOrder(next.groups.flatMap((g) => g.cards.map((c) => c.name)), next.id));
    } catch {
      showToast("Couldn't fetch a board — try again");
    } finally {
      setFetching(false);
    }
  }

  function backToDaily() {
    clearTimeout(solveTimer.current);
    setPendingSolve(null);
    setConfirmRedeal(false);
    endPeek();
    setMode("daily");
    setSelected([]);
    setOrder(
      seededOrder(initialPuzzle.groups.flatMap((g) => g.cards.map((c) => c.name)), initialPuzzle.id),
    );
    // Restore saved daily progress (endless wiped the in-memory guesses).
    try {
      const raw = localStorage.getItem(STATE_KEY);
      const saved = raw
        ? (JSON.parse(raw) as { date?: string; guesses?: string[][]; hints?: Record<number, number> })
        : null;
      const match = saved?.date === dateUtc;
      setGuesses(match && Array.isArray(saved.guesses) ? saved.guesses : []);
      setHintLevels(match && saved.hints && typeof saved.hints === "object" ? saved.hints : {});
    } catch {
      setGuesses([]);
      setHintLevels({});
    }
  }

  function bumpHint(gi: number) {
    if (status !== "playing") return;
    setHintLevels((h) => ({ ...h, [gi]: Math.min(3, (h[gi] ?? 0) + 1) }));
  }

  function shareText(): string {
    if (!puzzle) return "";
    const header =
      mode === "daily"
        ? `Confluence #${puzzleNumber} · Three Tree City`
        : "Confluence (endless) · Three Tree City";
    const rows = guesses
      .map((guess) => guess.map((n) => DIFF[puzzle.groups[groupOf.get(n) ?? 0].difficulty].emoji).join(""))
      .join("\n");
    const hintsUsed = Object.values(hintLevels).reduce((a, b) => a + b, 0);
    const result =
      (status === "won"
        ? mistakes === 0
          ? "Flawless — no mistakes!"
          : `Solved with ${mistakes} mistake${mistakes === 1 ? "" : "s"}`
        : `${solvedOrder.length}/4 groups`) +
      (hintsUsed > 0 ? ` · ${hintsUsed} hint${hintsUsed === 1 ? "" : "s"}` : "");
    return `${header}\n${rows}\n${result}`;
  }

  async function copyResult() {
    const text = shareText();
    const flash = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };
    try {
      await navigator.clipboard.writeText(text);
      flash();
      return;
    } catch {
      /* Clipboard API denied (embedded webviews, older Safari) — fall
         through to the execCommand shim. */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) {
        flash();
        return;
      }
    } catch {
      /* both paths failed — surface it */
    }
    showToast("Clipboard unavailable");
  }

  if (!puzzle) return null;

  /* Cards outed by a level-3 hint get a ring in their group's color
   * on the board (cleared naturally when the group solves). */
  const revealedHintCards = new Map<string, number>();
  for (const [giStr, lvl] of Object.entries(hintLevels)) {
    const gi = Number(giStr);
    if (lvl >= 3 && puzzle.groups[gi] && !solvedOrder.includes(gi)) {
      revealedHintCards.set(puzzle.groups[gi].cards[0].name, gi);
    }
  }

  /* Rows to render: solved in solve order; on a loss, the unsolved
   * remainder reveals underneath in difficulty order (NYT behavior),
   * cascading in with a small stagger. */
  const revealRows: { gi: number; revealed: boolean; delay: number }[] = [
    ...solvedOrder.map((gi) => ({ gi, revealed: false, delay: 0 })),
    ...(status === "lost"
      ? puzzle.groups
          .map((_, gi) => gi)
          .filter((gi) => !solvedOrder.includes(gi))
          .map((gi, i) => ({ gi, revealed: true, delay: i * 130 }))
      : []),
  ];

  return (
    // Hints live BELOW the board, never beside it — a side rail would
    // steal width from the tile grid, and in art mode board width is
    // exactly how big the card art gets.
    <div className="flex flex-col gap-4" style={{ fontFamily: "var(--font-ui)" }}>
    {/* p-2 below sm: on a 375px phone every horizontal pixel of chrome
        comes straight out of the four art tiles. */}
    <div className="liquid-panel rounded-2xl p-2 sm:p-5 relative w-full">
      {/* top bar: mode toggle + art toggle + mistake dots */}
      <div className="flex items-center justify-between gap-2 mb-3 sm:mb-4 flex-wrap">
        <div
          className="inline-flex items-center rounded-[10px] border border-[var(--color-line)] p-0.5"
          role="tablist"
          aria-label="Game mode"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "daily"}
            onClick={() => mode !== "daily" && backToDaily()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[8px] text-[12.5px] font-medium transition-colors"
            style={
              mode === "daily"
                ? { background: "var(--accent-purple)", color: "white" }
                : { color: "var(--color-fg)", opacity: 0.75 }
            }
          >
            <CalendarDays className="w-3.5 h-3.5" />
            Daily #{puzzleNumber}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "endless"}
            onClick={() => mode !== "endless" && loadEndless()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[8px] text-[12.5px] font-medium transition-colors"
            style={
              mode === "endless"
                ? { background: "var(--accent-purple)", color: "white" }
                : { color: "var(--color-fg)", opacity: 0.75 }
            }
          >
            <InfinityIcon className="w-3.5 h-3.5" />
            {fetching ? "Dealing…" : "Endless"}
          </button>
        </div>

        <div className="flex items-center gap-3">
          {mode === "endless" && (
            <button
              type="button"
              onClick={toggleRecent}
              aria-pressed={recentOnly}
              title={
                recentOnly
                  ? "Dealing from the newest premier sets — click for the full catalog"
                  : "Deal future boards from the newest premier sets only"
              }
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[8px] text-[12px] font-medium border transition-colors hover:bg-white/10"
              style={{
                color: recentOnly ? "white" : "var(--color-fg)",
                background: recentOnly ? "var(--accent-purple)" : "transparent",
                borderColor: recentOnly ? "transparent" : "var(--color-line)",
                opacity: recentOnly ? 1 : 0.75,
              }}
            >
              <Sparkles className="w-3.5 h-3.5" />
              New sets
            </button>
          )}
          <button
            type="button"
            onClick={toggleArt}
            aria-pressed={artMode}
            title={artMode ? "Hide card art (expert mode)" : "Show card art"}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[8px] text-[12px] font-medium border border-[var(--color-line)] hover:bg-white/10 transition-colors"
            style={{ color: "var(--color-fg)", opacity: artMode ? 1 : 0.75 }}
          >
            {artMode ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            Art
          </button>

          <div
            className="flex items-center gap-1.5"
            aria-label={`${4 - mistakes} of 4 tries remaining`}
            title="Remaining mistakes"
          >
            <span className="text-[11px] text-white/50 hidden sm:inline">Mistakes</span>
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className="w-2.5 h-2.5 rounded-full transition-all"
                style={{
                  background: i < 4 - mistakes ? "var(--accent-purple-light)" : "rgba(255,255,255,0.12)",
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* re-deal confirmation — shown only when the New-sets filter was
          toggled with a board mid-solve (see toggleRecent). */}
      {confirmRedeal && (
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3 rounded-xl border border-[var(--color-line)] px-3 py-2 anim-conn-rise">
          <p className="text-[12.5px] text-white/80">
            Deal a fresh board from {recentOnly ? "the newest sets" : "the full catalog"}? This
            board will be discarded.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => loadEndless()}
              className="h-8 px-3 rounded-[8px] text-[12px] font-semibold"
              style={{ background: "var(--accent-purple)", color: "white", fontFamily: "var(--font-btn)" }}
            >
              Deal it
            </button>
            <button
              type="button"
              onClick={() => setConfirmRedeal(false)}
              className="h-8 px-3 rounded-[8px] text-[12px] font-medium border border-[var(--color-line)] hover:bg-white/10 transition-colors"
              style={{ color: "var(--color-fg)", fontFamily: "var(--font-btn)" }}
            >
              Keep playing
            </button>
          </div>
        </div>
      )}

      {/* solved / revealed group rows */}
      {revealRows.length > 0 && (
        <div className="flex flex-col gap-2 mb-2">
          {revealRows.map(({ gi, revealed, delay }) => {
            const g = puzzle.groups[gi];
            return (
              <div
                key={g.title}
                className="rounded-xl px-2 py-2 sm:px-3 sm:py-2.5 anim-conn-rise"
                style={{
                  background: DIFF[g.difficulty].bg,
                  opacity: revealed ? 0.82 : 1,
                  animationDelay: delay ? `${delay}ms` : undefined,
                }}
              >
                <p
                  className="text-center text-[12px] font-bold uppercase tracking-[0.08em] mb-2"
                  style={{ color: INK }}
                >
                  {g.title}
                  {revealed && <span className="font-medium normal-case tracking-normal"> · missed</span>}
                </p>
                <div className="grid grid-cols-4 gap-1 sm:gap-2">
                  {g.cards.map((c) => (
                    <a
                      key={c.name}
                      href={`https://scryfall.com/card/${c.set}/${c.cn}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group/card block"
                      title={`${c.name} — view on Scryfall`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={c.art}
                        alt={c.name}
                        loading="lazy"
                        className="w-full aspect-square sm:aspect-[4/3] object-cover rounded-md"
                        style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.35)" }}
                      />
                      <p
                        className="mt-1 text-center text-[8.5px] sm:text-[10.5px] leading-tight font-semibold group-hover/card:underline"
                        style={{ color: INK }}
                      >
                        {c.name}
                      </p>
                    </a>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* tile grid — hidden once the game ends (on a loss the unsolved
          tiles would otherwise linger under the revealed rows). Keyed
          per board so the deal-in stagger replays on a new deal. */}
      {status === "playing" && remaining.length > 0 && (
        <div key={boardKey} className="grid grid-cols-4 gap-1 sm:gap-2" role="group" aria-label="Card tiles">
          {remaining.map((name, i) => {
            const isSel = selected.includes(name);
            const isHopping = pendingSolve?.includes(name) ?? false;
            const hopIndex = isHopping ? pendingSolve!.indexOf(name) : 0;
            const card = cardByName.get(name);
            const hintGi = revealedHintCards.get(name);
            const ring =
              hintGi !== undefined ? `0 0 0 2px ${DIFF[puzzle.groups[hintGi].difficulty].bg}` : null;
            const len = name.length;
            return (
              <button
                key={name}
                ref={flipRef(name)}
                type="button"
                aria-pressed={isSel}
                onClick={() => {
                  // A release that just closed a peek must not toggle.
                  if (peekShownRef.current) {
                    peekShownRef.current = false;
                    return;
                  }
                  toggleTile(name);
                }}
                onPointerDown={(e) => startPeek(name, e)}
                onPointerMove={movePeek}
                onPointerUp={endPeek}
                onPointerCancel={endPeek}
                onContextMenu={(e) => e.preventDefault()}
                className="anim-conn-deal rounded-xl text-center font-semibold leading-tight select-none"
                style={{
                  animationDelay: `${i * 22}ms`,
                  // No iOS save-image callout mid-hold — the hold is ours.
                  WebkitTouchCallout: "none",
                }}
              >
                <span
                  className={`flex flex-col items-stretch justify-center rounded-xl h-full w-full overflow-hidden transition-[background,box-shadow,transform] duration-150 ${
                    isSel && shaking ? "anim-conn-shake" : ""
                  } ${isHopping ? "anim-conn-hop" : ""}`}
                  style={{
                    background: isSel ? "var(--accent-purple)" : "rgba(255,255,255,0.055)",
                    color: isSel ? "white" : "var(--color-fg)",
                    border: `1px solid ${isSel ? "transparent" : "var(--color-line)"}`,
                    boxShadow:
                      [isSel ? "0 6px 16px -6px var(--accent-purple-glow)" : null, ring]
                        .filter(Boolean)
                        .join(", ") || "none",
                    transform: isSel && !isHopping ? "scale(0.97)" : undefined,
                    animationDelay: isHopping ? `${hopIndex * 80}ms` : undefined,
                  }}
                >
                  {artMode && card && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={card.art}
                      alt=""
                      loading="lazy"
                      draggable={false}
                      // Square below sm — on phone-width tiles the 5:3
                      // letterbox left ~45px of art; square nearly
                      // doubles it without breaking the 4×4 grid.
                      className="w-full aspect-square sm:aspect-[5/3] object-cover pointer-events-none"
                    />
                  )}
                  {/* Name sizes step down with length AND viewport —
                      phone tiles are ~78px wide, so text runs a couple
                      of points smaller there to keep the art dominant. */}
                  <span
                    className={`flex-1 flex items-center justify-center px-1 py-0.5 sm:px-1.5 sm:py-1 ${
                      len > 24
                        ? "text-[8.5px] sm:text-[10px]"
                        : len > 16
                          ? "text-[9px] sm:text-[11px]"
                          : "text-[10px] sm:text-[12.5px]"
                    } ${artMode ? "min-h-[24px] sm:min-h-[30px]" : "min-h-[56px] sm:min-h-[62px]"}`}
                    style={{ wordBreak: "break-word" }}
                  >
                    {name}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* toast */}
      <div aria-live="polite" role="status" className="pointer-events-none absolute left-0 right-0 top-16 flex justify-center z-10">
        {toast && (
          <span
            className="rounded-full px-4 py-1.5 text-[13px] font-medium anim-conn-rise"
            style={{ background: "rgba(20,14,42,0.95)", color: "var(--color-fg)", border: "1px solid var(--color-line-strong)" }}
          >
            {toast}
          </span>
        )}
      </div>

      {/* controls */}
      {status === "playing" && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            type="button"
            onClick={shuffleRemaining}
            disabled={locked}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[10px] text-[13px] font-medium border border-[var(--color-line)] hover:bg-white/10 transition-colors disabled:opacity-35"
            style={{ color: "var(--color-fg)", fontFamily: "var(--font-btn)" }}
          >
            <Shuffle className="w-3.5 h-3.5" />
            Shuffle
          </button>
          <button
            type="button"
            onClick={() => setSelected([])}
            disabled={selected.length === 0 || locked}
            className="h-9 px-4 rounded-[10px] text-[13px] font-medium border border-[var(--color-line)] hover:bg-white/10 transition-colors disabled:opacity-35 disabled:hover:bg-transparent"
            style={{ color: "var(--color-fg)", fontFamily: "var(--font-btn)" }}
          >
            Deselect
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={selected.length !== 4 || locked}
            className="h-9 px-5 rounded-[10px] text-[13px] font-semibold transition-all disabled:opacity-35"
            style={{
              background: "var(--accent-purple)",
              color: "white",
              fontFamily: "var(--font-btn)",
              boxShadow: selected.length === 4 && !locked ? "0 8px 20px -8px var(--accent-purple-glow)" : "none",
            }}
          >
            Submit
          </button>
        </div>
      )}

      {/* result panel */}
      {status !== "playing" && (
        <div className="mt-4 rounded-xl border border-[var(--color-line)] p-4 flex flex-col items-center gap-3 anim-conn-rise">
          <p className="text-[17px] font-semibold" style={{ fontFamily: "var(--font-btn)" }}>
            {status === "won"
              ? mistakes === 0
                ? "Flawless. Four for four. 🏆"
                : "Solved it! 🎉"
              : "Next time."}
          </p>
          <pre
            className="text-[15px] leading-[1.35] text-center m-0"
            style={{ fontFamily: "ui-monospace, monospace" }}
            aria-label="Your guess grid"
          >
            {guesses
              .map((guess) =>
                guess.map((n) => DIFF[puzzle.groups[groupOf.get(n) ?? 0].difficulty].emoji).join(""),
              )
              .join("\n")}
          </pre>

          {mode === "daily" && stats && (
            <div className="flex items-center gap-5 text-center">
              {(
                [
                  ["Played", stats.played],
                  ["Win %", stats.played ? Math.round((100 * stats.won) / stats.played) : 0],
                  ["Streak", stats.streak],
                  ["Best", stats.maxStreak],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <p className="text-[20px] font-bold leading-none">{value}</p>
                  <p className="text-[10.5px] uppercase tracking-wide text-white/55 mt-1">{label}</p>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap justify-center">
            <button
              type="button"
              onClick={copyResult}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[10px] text-[13px] font-semibold transition-all"
              style={{
                background: "var(--accent-purple)",
                color: "white",
                fontFamily: "var(--font-btn)",
                boxShadow: "0 8px 20px -8px var(--accent-purple-glow)",
              }}
            >
              <Share2 className="w-3.5 h-3.5" />
              {copied ? "Copied!" : "Copy result"}
            </button>
            <button
              type="button"
              // NOT a bare handler ref — the click event would land in
              // loadEndless's recentOverride param and read as truthy.
              onClick={() => loadEndless()}
              disabled={fetching}
              className="h-9 px-4 rounded-[10px] text-[13px] font-medium border border-[var(--color-line)] hover:bg-white/10 transition-colors disabled:opacity-50"
              style={{ color: "var(--color-fg)", fontFamily: "var(--font-btn)" }}
            >
              {fetching ? "Dealing…" : mode === "daily" ? "Play an endless board" : "New board"}
            </button>
            {mode === "endless" && (
              <button
                type="button"
                onClick={backToDaily}
                className="h-9 px-4 rounded-[10px] text-[13px] font-medium border border-[var(--color-line)] hover:bg-white/10 transition-colors"
                style={{ color: "var(--color-fg)", fontFamily: "var(--font-btn)" }}
              >
                Back to daily
              </button>
            )}
          </div>

          {mode === "daily" && (
            <p className="text-[11.5px] text-white/45">New board at midnight UTC.</p>
          )}
        </div>
      )}
    </div>

    {status === "playing" && (
      <HintsPanel
        groups={puzzle.groups}
        hintLevels={hintLevels}
        solvedOrder={solvedOrder}
        onHint={bumpHint}
      />
    )}

    {/* Press-and-hold art peek. Portalled to <body> (ancestor panels
        use backdrop-filter, which would trap position:fixed) and
        pointer-events-none throughout so the held finger's pointerup
        still lands on the tile and closes it. Art crop ONLY — the
        full card image would leak artist / type line / set symbol,
        i.e. three of the four group answers. */}
    {peek &&
      createPortal(
        <div className="fixed inset-0 z-[1200] grid place-items-center p-6 pointer-events-none" aria-hidden>
          <div
            className="absolute inset-0 bg-black/70"
            style={{ backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)" }}
          />
          <figure className="relative w-full max-w-[420px] m-0 anim-conn-peek">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={peek.art}
              alt={peek.name}
              draggable={false}
              className="w-full h-auto rounded-xl"
              style={{ boxShadow: "0 24px 60px -12px rgba(0,0,0,0.8)" }}
            />
            <figcaption
              className="mt-2.5 text-center text-[14px] font-semibold"
              style={{ color: "var(--color-fg)", fontFamily: "var(--font-ui)" }}
            >
              {peek.name}
            </figcaption>
          </figure>
        </div>,
        document.body,
      )}
    </div>
  );
}

/**
 * Below-board panel offering three escalating reveals per unsolved
 * group: what KIND of thread it is → the exact thread → one member
 * card (ringed on the board in the group's color). Group rows go
 * 2-across / 4-across on wider screens to stay shallow. Every reveal
 * counts into the shared result line, so a hinted flawless can't
 * masquerade as a clean one.
 */
function HintsPanel({
  groups,
  hintLevels,
  solvedOrder,
  onHint,
}: {
  groups: ConnectionsPuzzle["groups"];
  hintLevels: Record<number, number>;
  solvedOrder: number[];
  onHint: (gi: number) => void;
}) {
  const totalUsed = Object.values(hintLevels).reduce((a, b) => a + b, 0);
  const unsolved = groups
    .map((g, gi) => ({ g, gi }))
    .filter(({ gi }) => !solvedOrder.includes(gi));
  if (unsolved.length === 0) return null;

  return (
    <aside className="liquid-panel rounded-2xl p-4 w-full" aria-label="Hints">
      <div className="flex items-baseline justify-between">
        <p className="text-[14px] font-semibold" style={{ fontFamily: "var(--font-btn)" }}>
          Hints
        </p>
        {totalUsed > 0 && (
          <span className="text-[11px] text-white/50">
            {totalUsed} used
          </span>
        )}
      </div>
      <p className="text-[11.5px] text-white/50 mt-1 leading-snug">
        Stuck? Reveal a little at a time. Hints are counted in your shared
        result.
      </p>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5 mt-3">
        {unsolved.map(({ g, gi }) => {
          const lvl = hintLevels[gi] ?? 0;
          return (
            <div
              key={g.title}
              className="rounded-xl border border-[var(--color-line)] p-2.5"
            >
              <div className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: DIFF[g.difficulty].bg }}
                  aria-hidden
                />
                <span className="text-[10.5px] uppercase tracking-[0.08em] text-white/55">
                  {DIFF[g.difficulty].label} group
                </span>
              </div>
              {lvl >= 1 && (
                <p className="text-[12px] mt-1.5 leading-snug anim-conn-rise">{nudgeFor(g.key)}</p>
              )}
              {lvl >= 2 && (
                <p
                  className="text-[12.5px] mt-1 font-semibold anim-conn-rise"
                  style={{ color: DIFF[g.difficulty].bg }}
                >
                  {g.title}
                </p>
              )}
              {lvl >= 3 && (
                <p className="text-[12px] mt-1 leading-snug anim-conn-rise">
                  Includes <span className="font-semibold">{g.cards[0].name}</span> — now ringed
                  on the board.
                </p>
              )}
              {lvl < 3 && (
                <button
                  type="button"
                  onClick={() => onHint(gi)}
                  className="mt-2 h-7 px-2.5 rounded-[8px] text-[11.5px] font-medium border border-[var(--color-line)] hover:bg-white/10 transition-colors"
                  style={{ color: "var(--color-fg)", fontFamily: "var(--font-btn)" }}
                >
                  {lvl === 0 ? "Give me a nudge" : lvl === 1 ? "Name the thread" : "Reveal one card"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
