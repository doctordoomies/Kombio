import { describe, expect, it } from 'vitest';
import { act, cardCount, newGame, reject, rig, values } from './helpers';

// Player 0's turn; top discard is a 5 (deck-drawn discard by player 1 would also work).
const setup = (rules = {}) =>
  rig(newGame(2, 1, rules), { hands: [[5, 2, 3, 4], [5, 9, 7, 8]], deck: [11, 12, 13, 1], discard: [5] });

describe('matching own cards', () => {
  it('a correct match removes the card and leaves an empty slot', () => {
    const s = act(setup(), { type: 'match', player: 0, target: { player: 0, slot: 0 } }).state;
    expect(values(s, 0)).toEqual([null, 2, 3, 4]);
    expect(s.round.discard.at(-1)!.value).toBe(5);
    expect(s.round.discard).toHaveLength(2);
  });

  it('works out of turn', () => {
    const s = act(setup(), { type: 'match', player: 1, target: { player: 1, slot: 0 } }).state;
    expect(values(s, 1)).toEqual([null, 9, 7, 8]);
    expect(s.round.current).toBe(0);
  });

  it('an incorrect own match: card returns, a penalty card is added unseen, and the card is revealed to all', () => {
    const before = setup();
    const s = act(before, { type: 'match', player: 0, target: { player: 0, slot: 1 } }).state;
    expect(values(s, 0)).toEqual([5, 2, 3, 4, 11]);
    const penalty = s.round.hands[0][4]!;
    expect(s.round.known[0]).not.toContain(penalty.id);
    expect(s.round.known[1]).toContain(s.round.hands[0][1]!.id);
    expect(cardCount(s)).toBe(cardCount(before));
  });

  it('allows only one attempt per player per discarded card', () => {
    const s = act(setup(), { type: 'match', player: 0, target: { player: 0, slot: 1 } }).state;
    reject(s, { type: 'match', player: 0, target: { player: 0, slot: 0 } });
    // Other players still have their attempt.
    act(s, { type: 'match', player: 1, target: { player: 1, slot: 0 } });
  });

  it('a new discard resets the attempt', () => {
    let s = act(setup(), { type: 'match', player: 0, target: { player: 0, slot: 1 } }).state;
    s = act(s, { type: 'match', player: 1, target: { player: 1, slot: 0 } }).state; // new top: a 5
    s = act(s, { type: 'match', player: 0, target: { player: 0, slot: 0 } }).state;
    expect(values(s, 0)[0]).toBeNull();
  });

  it('the turn player cannot match while holding a drawn card', () => {
    const s = act(setup(), { type: 'drawDeck', player: 0 }).state;
    reject(s, { type: 'match', player: 0, target: { player: 0, slot: 0 } });
    act(s, { type: 'match', player: 1, target: { player: 1, slot: 0 } });
  });

  it('cannot match when there is no discard or during memorization', () => {
    const s = rig(newGame(2), { hands: [[5, 2, 3, 4], [5, 9, 7, 8]], deck: [1] });
    reject(s, { type: 'match', player: 0, target: { player: 0, slot: 0 } });
    const m = rig(newGame(2), { hands: [[5, 2, 3, 4], [5, 9, 7, 8]], deck: [1], discard: [5] }, false);
    reject(m, { type: 'match', player: 0, target: { player: 0, slot: 0 } });
  });

  it('cannot match an empty slot', () => {
    const s = act(setup(), { type: 'match', player: 0, target: { player: 0, slot: 0 } }).state;
    reject(s, { type: 'match', player: 1, target: { player: 0, slot: 0 } });
  });
});

describe("matching an opponent's card", () => {
  it('a correct match lets the matcher give one of their cards into the empty slot', () => {
    let s = act(setup(), { type: 'match', player: 0, target: { player: 1, slot: 0 } }).state;
    expect(s.round.interrupt).toEqual({ kind: 'give', giver: 0, receiver: 1, slot: 0 });
    // Everything else waits for the decision.
    reject(s, { type: 'drawDeck', player: 0 });
    reject(s, { type: 'match', player: 1, target: { player: 1, slot: 1 } });
    reject(s, { type: 'giveCard', player: 1, slot: 0 });
    s = act(s, { type: 'giveCard', player: 0, slot: 3 }).state;
    expect(values(s, 0)).toEqual([5, 2, 3, null]);
    expect(values(s, 1)).toEqual([4, 9, 7, 8]);
    expect(s.round.interrupt).toBeNull();
  });

  it('giving is optional by default and can be made required', () => {
    const s = act(setup(), { type: 'match', player: 0, target: { player: 1, slot: 0 } }).state;
    const declined = act(s, { type: 'declineGive', player: 0 }).state;
    expect(values(declined, 1)).toEqual([null, 9, 7, 8]);
    const req = act(setup({ giveAfterOpponentMatch: 'required' }), { type: 'match', player: 0, target: { player: 1, slot: 0 } }).state;
    reject(req, { type: 'declineGive', player: 0 });
  });

  it('an incorrect match: the opponent decides — matcher takes the card', () => {
    let s = act(setup(), { type: 'match', player: 0, target: { player: 1, slot: 1 } }).state;
    expect(s.round.interrupt).toMatchObject({ kind: 'mismatch', owner: 1, matcher: 0, slot: 1 });
    reject(s, { type: 'resolveMismatch', player: 0, choice: 'matcherTakes' });
    s = act(s, { type: 'resolveMismatch', player: 1, choice: 'matcherTakes' }).state;
    expect(values(s, 0)).toEqual([5, 2, 3, 4, 9]);
    expect(values(s, 1)).toEqual([5, null, 7, 8]);
  });

  it('an incorrect match: the opponent decides — card returned, matcher takes a penalty card', () => {
    const before = setup();
    let s = act(before, { type: 'match', player: 0, target: { player: 1, slot: 1 } }).state;
    s = act(s, { type: 'resolveMismatch', player: 1, choice: 'returnAndPenalty' }).state;
    expect(values(s, 0)).toEqual([5, 2, 3, 4, 11]);
    expect(values(s, 1)).toEqual([5, 9, 7, 8]);
    expect(cardCount(s)).toBe(cardCount(before));
  });
});

describe('automatic KOMBIO when a hand is emptied', () => {
  it('matching your last card is an automatic call; others then get one more turn', () => {
    let s = rig(newGame(2), { hands: [[5], [1, 2, 3, 4]], deck: [6, 6, 6], discard: [5] });
    s = act(s, { type: 'match', player: 0, target: { player: 0, slot: 0 } }).state;
    expect(s.round.caller).toBe(0);
    // Player 0's turn is still in progress (they cannot exchange, but may draw and discard).
    reject(s, { type: 'takeDiscard', player: 0 });
    s = act(s, { type: 'drawDeck', player: 0 }).state;
    s = act(s, { type: 'discardHeld', player: 0 }).state;
    expect(s.round.current).toBe(1);
    s = act(s, { type: 'drawDeck', player: 1 }).state;
    s = act(s, { type: 'discardHeld', player: 1 }).state;
    expect(s.round.phase).toBe('ended');
    expect(s.round.result!.roundScores).toEqual([0, 10 + 10]);
  });
});
