import { describe, expect, it } from 'vitest';
import { buildDeck, DEFAULT_DECK, seededRng, shuffle } from '../src/engine';
import { newGame } from './helpers';

describe('deck composition', () => {
  const deck = buildDeck(DEFAULT_DECK);

  it('has 70 cards: 36 non-ability cards (-1..6) and 34 ability cards (7..14)', () => {
    expect(deck).toHaveLength(70);
    expect(deck.filter((c) => c.value < 7)).toHaveLength(36);
    expect(deck.filter((c) => c.value >= 7)).toHaveLength(34);
  });

  it('has the expected per-value counts', () => {
    const counts = new Map<number, number>();
    for (const c of deck) counts.set(c.value, (counts.get(c.value) ?? 0) + 1);
    expect(counts.get(-1)).toBe(3);
    expect(counts.get(0)).toBe(3);
    for (let v = 1; v <= 12; v++) expect(counts.get(v)).toBe(5);
    expect(counts.get(13)).toBe(2);
    expect(counts.get(14)).toBe(2); // rulebook add-on refers to "both 14's"
  });

  it('assigns unique stable IDs', () => {
    expect(new Set(deck.map((c) => c.id)).size).toBe(70);
  });
});

describe('shuffling', () => {
  it('is deterministic for an injected RNG and preserves the cards', () => {
    const deck = buildDeck(DEFAULT_DECK);
    const a = shuffle(deck, seededRng(42));
    const b = shuffle(deck, seededRng(42));
    expect(a).toEqual(b);
    expect(a).not.toEqual(deck);
    expect([...a].sort((x, y) => x.id - y.id)).toEqual(deck);
  });

  it('does not mutate its input', () => {
    const deck = buildDeck(DEFAULT_DECK);
    const copy = deck.slice();
    shuffle(deck, seededRng(7));
    expect(deck).toEqual(copy);
  });

  it('same seed gives the same game; different seeds differ', () => {
    expect(newGame(2, 5)).toEqual(newGame(2, 5));
    expect(newGame(2, 5).round.deck).not.toEqual(newGame(2, 6).round.deck);
  });
});

describe('dealing', () => {
  it('deals four cards to each player and leaves the discard pile empty', () => {
    const s = newGame(3);
    expect(s.round.hands.map((h) => h.length)).toEqual([4, 4, 4]);
    expect(s.round.discard).toHaveLength(0);
    expect(s.round.deck).toHaveLength(70 - 12);
    expect(s.round.phase).toBe('memorize');
  });

  it('can flip an initial discard when configured (prototype behaviour)', () => {
    const s = newGame(2, 1, { initialDiscard: true });
    expect(s.round.discard).toHaveLength(1);
    expect(s.round.deck).toHaveLength(70 - 9);
  });

  it('rejects unsupported player counts', () => {
    expect(() => newGame(1)).toThrow();
    expect(() => newGame(7)).toThrow();
  });

  it('each player initially knows exactly their bottom two cards', () => {
    const s = newGame(2);
    for (let p = 0; p < 2; p++) {
      const h = s.round.hands[p];
      expect(s.round.known[p].sort()).toEqual([h[2]!.id, h[3]!.id].sort());
    }
  });
});
