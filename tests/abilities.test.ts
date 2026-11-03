import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/engine';
import { act, newGame, reject, rig, values } from './helpers';

/** Player 0 draws `card` from the deck and discards it, entering its ability. */
function withAbility(card: number, players = 2, rules = {}): GameState {
  const hands = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]].slice(0, players);
  let s = rig(newGame(players, 1, rules), { hands, deck: [card, 0, 0, 0] });
  s = act(s, { type: 'drawDeck', player: 0 }).state;
  return act(s, { type: 'discardHeld', player: 0 }).state;
}

describe('ability cards', () => {
  it('cards below 7 have no ability', () => {
    let s = rig(newGame(2), { hands: [[1, 2, 3, 4], [5, 6, 7, 8]], deck: [6] });
    s = act(s, { type: 'drawDeck', player: 0 }).state;
    s = act(s, { type: 'discardHeld', player: 0 }).state;
    expect(s.round.step.kind).toBe('start');
    expect(s.round.current).toBe(1);
  });

  it.each([7, 8])('%i: look at one of your own cards', (v) => {
    const s = withAbility(v);
    expect(s.round.step).toMatchObject({ kind: 'ability', ability: 'peekOwn' });
    reject(s, { type: 'usePeek', player: 0, target: { player: 1, slot: 0 } });
    const next = act(s, { type: 'usePeek', player: 0, target: { player: 0, slot: 0 } }).state;
    expect(next.round.known[0]).toContain(s.round.hands[0][0]!.id);
    expect(next.round.current).toBe(1);
  });

  it.each([9, 10])("%i: look at one opponent's card", (v) => {
    const s = withAbility(v);
    reject(s, { type: 'usePeek', player: 0, target: { player: 0, slot: 0 } });
    const next = act(s, { type: 'usePeek', player: 0, target: { player: 1, slot: 0 } }).state;
    expect(next.round.known[0]).toContain(s.round.hands[1][0]!.id);
    expect(next.round.known[1]).not.toContain(s.round.hands[1][0]!.id);
  });

  it.each([11, 12])('%i: blind swap any two cards without viewing them', (v) => {
    const s = withAbility(v, 3);
    reject(s, { type: 'usePeek', player: 0, target: { player: 0, slot: 0 } });
    reject(s, { type: 'useSwap', player: 0, a: { player: 1, slot: 0 }, b: { player: 1, slot: 0 } });
    // Swapping between two opponents' hands is allowed.
    const next = act(s, { type: 'useSwap', player: 0, a: { player: 1, slot: 0 }, b: { player: 2, slot: 1 } }).state;
    expect(values(next, 1)).toEqual([10, 6, 7, 8]);
    expect(values(next, 2)).toEqual([9, 5, 11, 12]);
    expect(next.round.known[0]).not.toContain(next.round.hands[1][0]!.id);
  });

  it('13: look at any card, then optionally exchange it with another (unviewed) card', () => {
    let s = withAbility(13);
    reject(s, { type: 'useSwap', player: 0, a: { player: 0, slot: 0 }, b: { player: 1, slot: 0 } });
    s = act(s, { type: 'usePeek', player: 0, target: { player: 1, slot: 1 } }).state;
    expect(s.round.step).toMatchObject({ kind: 'ability', stage: 'decide' });
    // The exchange must involve the viewed card.
    reject(s, { type: 'useSwap', player: 0, a: { player: 0, slot: 0 }, b: { player: 1, slot: 0 } });
    const swapped = act(s, { type: 'useSwap', player: 0, a: { player: 1, slot: 1 }, b: { player: 0, slot: 0 } }).state;
    expect(values(swapped, 0)).toEqual([6, 2, 3, 4]);
    expect(values(swapped, 1)).toEqual([5, 1, 7, 8]);
    expect(swapped.round.known[0]).not.toContain(s.round.hands[0][0]!.id); // player 0 never saw their slot 0
    const kept = act(s, { type: 'skipAbility', player: 0 }).state;
    expect(values(kept, 0)).toEqual([1, 2, 3, 4]);
    expect(kept.round.current).toBe(1);
  });

  it('14: look at any two cards, then optionally exchange them', () => {
    let s = withAbility(14);
    reject(s, { type: 'useDoublePeek', player: 0, a: { player: 1, slot: 0 }, b: { player: 1, slot: 0 } });
    s = act(s, { type: 'useDoublePeek', player: 0, a: { player: 0, slot: 0 }, b: { player: 1, slot: 3 } }).state;
    expect(s.round.known[0]).toEqual(expect.arrayContaining([s.round.hands[0][0]!.id, s.round.hands[1][3]!.id]));
    reject(s, { type: 'useSwap', player: 0, a: { player: 0, slot: 0 }, b: { player: 1, slot: 2 } });
    s = act(s, { type: 'useSwap', player: 0, a: { player: 0, slot: 0 }, b: { player: 1, slot: 3 } }).state;
    expect(values(s, 0)).toEqual([8, 2, 3, 4]);
    expect(values(s, 1)).toEqual([5, 6, 7, 1]);
  });

  it('abilities are optional', () => {
    const s = act(withAbility(11), { type: 'skipAbility', player: 0 }).state;
    expect(s.round.current).toBe(1);
  });

  it('a card discarded from a hand (via replace) has no ability', () => {
    let s = rig(newGame(2), { hands: [[13, 2, 3, 4], [5, 6, 7, 8]], deck: [1] });
    s = act(s, { type: 'drawDeck', player: 0 }).state;
    s = act(s, { type: 'replace', player: 0, slot: 0 }).state;
    expect(s.round.discard.at(-1)!.value).toBe(13);
    expect(s.round.step.kind).toBe('start');
    expect(s.round.current).toBe(1);
  });

  it("knowledge follows a card when it is swapped (everyone sees which positions moved)", () => {
    let s = withAbility(11);
    const known = s.round.hands[0][2]!.id; // player 0 knows their bottom cards
    s = act(s, { type: 'useSwap', player: 0, a: { player: 0, slot: 2 }, b: { player: 1, slot: 0 } }).state;
    expect(s.round.hands[1][0]!.id).toBe(known);
    expect(s.round.known[0]).toContain(known);
  });
});
