import { describe, expect, it } from 'vitest';
import { decideAction, decideMatch } from '../src/ai/opponent';
import { applyAction, createGame, getPlayerView, type GameState } from '../src/engine';
import { act, cardCount, newGame, rig } from './helpers';

describe('computer opponent knowledge restrictions', () => {
  it('makes identical decisions when only hidden information differs', () => {
    // Player 1's view is the same in both; hidden cards (player 0 slots 0-1, player 1 slots 0-1, deck) differ.
    const a = rig(newGame(2), { hands: [[1, 2, 3, 4], [5, 6, 7, 8]], deck: [9, 9], discard: [2] });
    const b = rig(newGame(2), { hands: [[14, 0, 3, 4], [12, 13, 7, 8]], deck: [1, 1], discard: [2] });
    for (const s of [a, b]) s.round.current = 1;
    expect(getPlayerView(a, 1)).toEqual(getPlayerView(b, 1));
    expect(decideAction(getPlayerView(a, 1))).toEqual(decideAction(getPlayerView(b, 1)));
  });

  it('only matches cards it knows', () => {
    // Top discard is 7; player 1 knows its slot 2 (a 7). It does not know player 0's 7 in slot 0.
    const s = rig(newGame(2), { hands: [[7, 2, 3, 4], [5, 6, 7, 8]], deck: [9], discard: [7] });
    expect(decideMatch(getPlayerView(s, 1))).toEqual({ type: 'match', player: 1, target: { player: 1, slot: 2 } });
    const unknownOnly = rig(newGame(2), { hands: [[7, 2, 3, 4], [5, 6, 1, 8]], deck: [9], discard: [7] });
    expect(decideMatch(getPlayerView(unknownOnly, 1))).toBeNull();
  });

  it('replaces its highest known card with a lower drawn card', () => {
    let s = rig(newGame(2), { hands: [[1, 2, 3, 4], [5, 6, 2, 12]], deck: [0, 3] });
    s = act(s, { type: 'drawDeck', player: 0 }).state;
    s = act(s, { type: 'discardHeld', player: 0 }).state;
    s = act(s, { type: 'drawDeck', player: 1 }).state; // draws 3
    expect(decideAction(getPlayerView(s, 1))).toEqual({ type: 'replace', player: 1, slot: 3 });
  });

  it('peeks at its own unknown cards with a 7/8', () => {
    let s = rig(newGame(2), { hands: [[1, 2, 3, 4], [5, 6, 2, 3]], deck: [0, 7] });
    s = act(s, { type: 'drawDeck', player: 0 }).state;
    s = act(s, { type: 'discardHeld', player: 0 }).state;
    s = act(s, { type: 'drawDeck', player: 1 }).state;
    s = act(s, decideAction(getPlayerView(s, 1))!).state; // discards the 7
    expect(decideAction(getPlayerView(s, 1))).toMatchObject({ type: 'usePeek', target: { player: 1 } });
  });
});

/** Plays complete games with computer players only, checking invariants after every action. */
function autoplay(seed: number, players: number, rounds: number): GameState {
  let { state } = createGame({ players: Array.from({ length: players }, (_, i) => `CPU${i}`), seed, rules: { maxRounds: rounds } });
  const total = cardCount(state);
  for (let i = 0; i < 20000 && !state.gameOver; i++) {
    if (state.round.phase === 'ended') {
      state = act(state, { type: 'nextRound', player: 0 }).state;
      continue;
    }
    let action = null;
    for (let p = 0; p < players && !action; p++) action = decideMatch(getPlayerView(state, p));
    for (let p = 0; p < players && !action; p++) action = decideAction(getPlayerView(state, p));
    if (!action) throw new Error(`no player could act (seed ${seed}, step ${i})`);
    const r = applyAction(state, action);
    if (!r.ok) throw new Error(`AI chose illegal ${JSON.stringify(action)}: ${r.error} (seed ${seed})`);
    state = r.state;
    if (state.round.phase !== 'ended') expect(cardCount(state)).toBe(total);
  }
  return state;
}

describe('full computer-only games', () => {
  it.each([2, 3, 4, 6])('%i players complete multiple rounds using only legal actions', (players) => {
    for (let seed = 1; seed <= 15; seed++) {
      const end = autoplay(seed * 97 + players, players, 3);
      expect(end.gameOver).toBe(true);
      expect(end.history).toHaveLength(3);
      expect(end.scores).toEqual(end.history.reduce((acc, h) => acc.map((s, i) => s + h.roundScores[i]), new Array(players).fill(0)));
    }
  });
});
