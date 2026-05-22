"use client";

import type { Rarity } from "./scryfall";

const KEY = "mythicpulls:collection:v1";

export interface CollectionEntry {
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

/** Read all entries. Safe on SSR — returns []. */
export function readCollection(): CollectionEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CollectionEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCollection(entries: CollectionEntry[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(entries));
  window.dispatchEvent(new CustomEvent("mythicpulls:collection-change"));
}

export function addToCollection(entries: CollectionEntry[]) {
  const current = readCollection();
  writeCollection([...current, ...entries]);
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
