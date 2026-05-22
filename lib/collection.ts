"use client";

import type { Rarity } from "./scryfall";

const KEY = "mythicpulls:collection:v1";

export interface CollectionEntry {
  /** Stable unique id per saved card. Used by the binder as the React
   *  list key. Pre-existing entries from before this field was added
   *  get one filled in lazily at read time and persisted back (see
   *  readCollection). Generated via crypto.randomUUID when available,
   *  otherwise a timestamp+random fallback. */
  entryId: string;
  cardId: string;
  name: string;
  rarity: Rarity;
  setCode: string;
  setName: string;
  collectorNumber: string;
  image: string;
  foil: boolean;
  pulledAt: number;
}

/** Generate a new entry id. crypto.randomUUID is widely available in
 *  modern browsers; the fallback keeps things working in older ones. */
export function makeEntryId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Read all entries. Safe on SSR — returns []. Also backfills `entryId`
 *  on any legacy entries written before that field existed, AND repairs
 *  any duplicate entryIds it finds in storage by minting a fresh id for
 *  the colliding ones. Persists either repair so subsequent reads are
 *  stable (the binder needs that for drag/reorder).
 *
 *  Duplicates can sneak in a few ways: a tab race that ran the migration
 *  on the same data twice, the same `pulled` array being saved more than
 *  once with already-stamped entries, or manual edits to localStorage.
 *  We don't try to figure out which one happened — just make sure the
 *  binder doesn't crash with duplicate React keys. */
export function readCollection(): CollectionEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<CollectionEntry>[];
    if (!Array.isArray(parsed)) return [];
    let mutated = false;
    const seen = new Set<string>();
    const out: CollectionEntry[] = parsed.map((e) => {
      let id = e.entryId;
      if (!id || seen.has(id)) {
        // Missing OR colliding — mint a fresh one.
        id = makeEntryId();
        mutated = true;
      }
      seen.add(id);
      return { ...e, entryId: id } as CollectionEntry;
    });
    if (mutated) {
      window.localStorage.setItem(KEY, JSON.stringify(out));
    }
    return out;
  } catch {
    return [];
  }
}

function writeCollection(entries: CollectionEntry[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(entries));
  window.dispatchEvent(new CustomEvent("mythicpulls:collection-change"));
}

/** Append entries to the collection. Any entry missing an entryId gets
 *  one generated here, so callers don't have to remember. */
export function addToCollection(entries: Array<Omit<CollectionEntry, "entryId"> & Partial<Pick<CollectionEntry, "entryId">>>) {
  const current = readCollection();
  const stamped: CollectionEntry[] = entries.map((e) => ({
    ...e,
    entryId: e.entryId ?? makeEntryId(),
  } as CollectionEntry));
  writeCollection([...current, ...stamped]);
}

export function clearCollection() {
  writeCollection([]);
}

export function removeFromCollection(predicate: (e: CollectionEntry, i: number) => boolean) {
  const current = readCollection();
  writeCollection(current.filter((e, i) => !predicate(e, i)));
}

/** Overwrite the collection in a single transaction (used for reorder). */
export function setCollection(entries: CollectionEntry[]) {
  writeCollection(entries);
}
