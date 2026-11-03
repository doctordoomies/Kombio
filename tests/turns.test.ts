import { describe, expect, it } from 'vitest';
import { act, cardCount, newGame, reject, rig, values } from './helpers';

const base = () => rig(newGame(2), { hands: [[1, 2, 3, 4], [5, 6, 7, 8]], deck: [9, 10, 2, 3], discard: [] });

describe('memorization phase', () => {
  it('blocks play until every player is ready', () => {
    const s = rig(newGame(2), { hands: [[1, 2, 3, 4], [5, 6, 7, 8]], deck: [9] }, false);
    reject(s, { type: 'drawDeck', player: 0 });
    const s1 = act(s, { type: 'ready', player: 0 }).state;
    reject(s1, { type: 'ready', player: 0 });
    reject(s1, { type: 'drawDeck', player: 0 });
    const s2 = act(s1, { type: 'ready', player: 1 }).state;
    expect(s2.round.phase).toBe('playing');
    expect(s2.round.current).toBe(0);
  });
});

describe('drawing and replacing', () => {
  it('draw from deck, then replace a hand card: old card goes face up on the discard', () => {
    let s = base();
    s = act(s, { type: 'drawDeck', player: 0 }).state;
    expect(s.round.step).toMatchObject({ kind: 'holding', source: 'deck' });
    s = act(s, { type: 'replace', player: 0, slot: 1 }).state;
    expect(values(s, 0)).toEqual([1, 9, 3, 4]);
    expect(s.round.discard.at(-1)!.value).toBe(2);
    expect(s.round.current).toBe(1);
    expect(s.round.known[0]).toContain(s.round.hands[0][1]!.id);
  });

  it('draw from deck and discard it (non-ability card) ends the turn', () => {
    let s = rig(newGame(2), { hands: [[1, 2, 3, 4], [5, 6, 7, 8]], deck: [5] });
    s = act(s, { type: 'drawDeck', player: 0 }).state;
    s = act(s, { type: 'discardHeld', player: 0 }).state;
    expect(s.round.discard.at(-1)!.value).toBe(5);
    expect(s.round.current).toBe(1);
  });

  it('a card taken from the discard pile must be exchanged, and everyone knows it', () => {
    let s = rig(newGame(2), { hands: [[1, 2, 3, 4], [5, 6, 7, 8]], deck: [9], discard: [0] });
    s = act(s, { type: 'takeDiscard', player: 0 }).state;
    reject(s, { type: 'discardHeld', player: 0 });
    s = act(s, { type: 'replace', player: 0, slot: 0 }).state;
    const taken = s.round.hands[0][0]!;
    expect(taken.value).toBe(0);
    expect(s.round.known[1]).toContain(taken.id);
    expect(s.round.discard.at(-1)!.value).toBe(1);
  });

  it('the first player cannot take an empty discard pile', () => {
    reject(base(), { type: 'takeDiscard', player: 0 });
  });

  it('conserves cards through a sequence of turns', () => {
    let s = base();
    const total = cardCount(s);
    s = act(s, { type: 'drawDeck', player: 0 }).state;
    expect(cardCount(s)).toBe(total);
    s = act(s, { type: 'replace', player: 0, slot: 0 }).state;
    s = act(s, { type: 'drawDeck', player: 1 }).state;
    s = act(s, { type: 'discardHeld', player: 1 }).state;
    expect(cardCount(s)).toBe(total);
  });
});

describe('illegal actions', () => {
  it('rejects out-of-turn and out-of-step actions without mutating state', () => {
    const s = base();
    reject(s, { type: 'drawDeck', player: 1 });
    reject(s, { type: 'replace', player: 0, slot: 0 });
    reject(s, { type: 'discardHeld', player: 0 });
    reject(s, { type: 'skipAbility', player: 0 });
    reject(s, { type: 'usePeek', player: 0, target: { player: 0, slot: 0 } });
    reject(s, { type: 'nextRound', player: 0 });
    reject(s, { type: 'drawDeck', player: 9 });
    reject(s, { type: 'giveCard', player: 0, slot: 0 });
    reject(s, { type: 'resolveMismatch', player: 0, choice: 'matcherTakes' });
  });

  it('rejects invalid slots', () => {
    const s = act(base(), { type: 'drawDeck', player: 0 }).state;
    reject(s, { type: 'replace', player: 0, slot: 4 });
    reject(s, { type: 'replace', player: 0, slot: -1 });
    reject(s, { type: 'drawDeck', player: 0 });
  });

  it('does not allow passing when a move is available', () => {
    reject(base(), { type: 'pass', player: 0 });
  });
});
