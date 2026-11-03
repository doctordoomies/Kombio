import type { Card } from './cards';
import type { Rng } from './rng';

export interface DeckEntry {
  value: number;
  count: number;
}

/** Builds an unshuffled deck. IDs are 1..N in composition order and are stable for the whole game. */
export function buildDeck(composition: readonly DeckEntry[]): Card[] {
  const cards: Card[] = [];
  let id = 0;
  for (const { value, count } of composition) {
    for (let i = 0; i < count; i++) cards.push({ id: ++id, value });
  }
  return cards;
}

/** Fisher–Yates shuffle. Returns a new array; the input is not modified. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
