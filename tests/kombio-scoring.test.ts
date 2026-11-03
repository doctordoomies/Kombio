import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, scoreRound, type Card } from '../src/engine';
import { act, newGame, reject, rig } from './helpers';

const cards = (...v: number[]): Card[] => v.map((value, i) => ({ id: i + 1, value }));

describe('scoring', () => {
  it('caller strictly lowest: caller gets hand score, everyone else +10', () => {
    const r = scoreRound([cards(1, 2), cards(5, 5), cards(3, 3)], 0, DEFAULT_RULES);
    expect(r.callerWon).toBe(true);
    expect(r.roundScores).toEqual([3, 20, 16]);
  });

  it('caller tied: caller +15, everyone else their hand score', () => {
    const r = scoreRound([cards(3), cards(1, 2)], 0, DEFAULT_RULES);
    expect(r.callerWon).toBe(false);
    expect(r.roundScores).toEqual([18, 3]);
  });

  it('caller beaten: caller +15', () => {
    const r = scoreRound([cards(10), cards(2), cards(20)], 0, DEFAULT_RULES);
    expect(r.roundScores).toEqual([25, 2, 20]);
  });

  it('negative and empty hands', () => {
    const r = scoreRound([cards(), cards(-1, 0)], 1, DEFAULT_RULES);
    expect(r.handScores).toEqual([0, -1]);
    expect(r.roundScores).toEqual([10, -1]);
  });

  it('add-ons are off by default and apply when enabled', () => {
    expect(scoreRound([cards(14, 14), cards(1)], null, DEFAULT_RULES).handScores).toEqual([28, 1]);
    const on = { ...DEFAULT_RULES, addOnDoubleFourteen: true, addOnFourteenTwentyFive: true };
    expect(scoreRound([cards(14, 14), cards(14, 11), cards(14, 10, 1), cards(14, 14, 1)], null, on).handScores).toEqual([-15, -10, -10, 29]);
    // Add-on scores feed the caller comparison.
    const r = scoreRound([cards(14, 14), cards(0)], 0, on);
    expect(r.callerWon).toBe(true);
    expect(r.roundScores).toEqual([-15, 10]);
  });
});

describe('calling KOMBIO', () => {
  const play = (players = 2) =>
    rig(newGame(players), {
      hands: [[1, 1, 1, 1], [5, 5, 5, 5], [6, 6, 6, 6]].slice(0, players),
      deck: [6, 6, 6, 6, 6, 6],
    });

  it('can only be called in place of a turn', () => {
    const s = play();
    reject(s, { type: 'callKombio', player: 1 });
    const holding = act(s, { type: 'drawDeck', player: 0 }).state;
    reject(holding, { type: 'callKombio', player: 0 });
  });

  it('2 players: the opponent gets exactly one more turn, then the round is scored', () => {
    let s = act(play(), { type: 'callKombio', player: 0 }).state;
    expect(s.round.caller).toBe(0);
    expect(s.round.current).toBe(1);
    reject(s, { type: 'callKombio', player: 1 });
    s = act(s, { type: 'drawDeck', player: 1 }).state;
    s = act(s, { type: 'discardHeld', player: 1 }).state;
    expect(s.round.phase).toBe('ended');
    expect(s.round.result!.roundScores).toEqual([4, 30]);
    expect(s.scores).toEqual([4, 30]);
  });

  it('3 players: each other player gets one final turn, and the caller is skipped', () => {
    let s = act(play(3), { type: 'drawDeck', player: 0 }).state;
    s = act(s, { type: 'discardHeld', player: 0 }).state;
    s = act(s, { type: 'callKombio', player: 1 }).state;
    expect(s.round.current).toBe(2);
    expect(s.round.finalQueue).toEqual([0]);
    s = act(s, { type: 'drawDeck', player: 2 }).state;
    s = act(s, { type: 'replace', player: 2, slot: 0 }).state;
    expect(s.round.current).toBe(0);
    s = act(s, { type: 'drawDeck', player: 0 }).state;
    s = act(s, { type: 'replace', player: 0, slot: 0 }).state;
    expect(s.round.phase).toBe('ended');
  });

  it("3+ players: the caller's hand is locked from viewing, matching and swapping", () => {
    let s = rig(newGame(3), { hands: [[1, 1, 1, 1], [5, 5, 5, 5], [6, 6, 6, 6]], deck: [9, 11, 5, 9], discard: [] });
    s = act(s, { type: 'callKombio', player: 0 }).state;
    s = act(s, { type: 'drawDeck', player: 1 }).state;
    s = act(s, { type: 'discardHeld', player: 1 }).state; // 9: look at others
    reject(s, { type: 'usePeek', player: 1, target: { player: 0, slot: 0 } });
    s = act(s, { type: 'usePeek', player: 1, target: { player: 2, slot: 0 } }).state;
    s = act(s, { type: 'drawDeck', player: 2 }).state;
    s = act(s, { type: 'discardHeld', player: 2 }).state; // 11: blind swap
    reject(s, { type: 'useSwap', player: 2, a: { player: 0, slot: 0 }, b: { player: 2, slot: 0 } });
    // Matching against the caller's hand is refused too (top discard is 11; give the caller an 11 to test).
    const probe = structuredClone(s);
    probe.round.hands[0][0] = { id: 9999, value: 11 };
    reject(probe, { type: 'match', player: 1, target: { player: 0, slot: 0 } });
  });

  it("2 players: the caller's hand is not locked", () => {
    let s = rig(newGame(2), { hands: [[1, 1, 1, 1], [5, 5, 5, 5]], deck: [11, 9] });
    s = act(s, { type: 'callKombio', player: 0 }).state;
    s = act(s, { type: 'drawDeck', player: 1 }).state;
    s = act(s, { type: 'discardHeld', player: 1 }).state;
    act(s, { type: 'useSwap', player: 1, a: { player: 0, slot: 0 }, b: { player: 1, slot: 0 } });
  });

  it("a KOMBIO call made out of turn still gives the in-progress player a full extra turn", () => {
    // Player 1 empties their hand by matching while player 0 is resolving an ability.
    let s = rig(newGame(2), { hands: [[1, 2, 3, 4], [13]], deck: [13, 6, 6] });
    s = act(s, { type: 'drawDeck', player: 0 }).state;
    s = act(s, { type: 'discardHeld', player: 0 }).state; // 13: look & swap
    s = act(s, { type: 'match', player: 1, target: { player: 1, slot: 0 } }).state;
    expect(s.round.caller).toBe(1);
    expect(s.round.current).toBe(0);
    s = act(s, { type: 'skipAbility', player: 0 }).state;
    // Player 0's interrupted turn does not count: they get one more full turn.
    expect(s.round.current).toBe(0);
    expect(s.round.step.kind).toBe('start');
    expect(s.round.finalQueue).toEqual([]);
    s = act(s, { type: 'drawDeck', player: 0 }).state;
    s = act(s, { type: 'discardHeld', player: 0 }).state;
    expect(s.round.phase).toBe('ended');
  });
});

describe('multiple rounds', () => {
  it('accumulates scores, rotates the dealer, and ends at the round limit', () => {
    let s = rig(newGame(2, 1, { maxRounds: 2 }), { hands: [[1, 1, 1, 1], [5, 5, 5, 5]], deck: [6] });
    s = act(s, { type: 'callKombio', player: 0 }).state;
    s = act(s, { type: 'drawDeck', player: 1 }).state;
    s = act(s, { type: 'discardHeld', player: 1 }).state;
    expect(s.scores).toEqual([4, 30]);
    reject(s, { type: 'drawDeck', player: 0 });
    s = act(s, { type: 'nextRound', player: 0 }).state;
    expect(s.round.number).toBe(2);
    expect(s.round.dealer).toBe(0);
    expect(s.round.current).toBe(1);
    expect(s.round.hands.every((h) => h.length === 4)).toBe(true);
    s = rig(s, { hands: [[2, 2, 2, 2], [1, 1, 1, 1]], deck: [3] });
    s = act(s, { type: 'callKombio', player: 1 }).state;
    s = act(s, { type: 'drawDeck', player: 0 }).state;
    s = act(s, { type: 'discardHeld', player: 0 }).state;
    expect(s.scores).toEqual([4 + 18, 30 + 4]);
    expect(s.history).toHaveLength(2);
    expect(s.gameOver).toBe(true);
    expect(s.winners).toEqual([0]);
    reject(s, { type: 'nextRound', player: 0 });
  });

  it('ends at the score limit', () => {
    let s = rig(newGame(2, 1, { scoreLimit: 25 }), { hands: [[1, 1, 1, 1], [5, 5, 5, 5]], deck: [6] });
    s = act(s, { type: 'callKombio', player: 0 }).state;
    s = act(s, { type: 'drawDeck', player: 1 }).state;
    s = act(s, { type: 'discardHeld', player: 1 }).state;
    expect(s.gameOver).toBe(true);
  });
});
