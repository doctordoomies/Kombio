import { describe, expect, it } from 'vitest';
import { decideAction, decideMatch, expectedUnknownValue, PROFILES, unseenAverage, type Difficulty } from '../src/ai/opponent';
import { getPlayerView, type GameState } from '../src/engine';
import { act, autoplayGame, newGame, rig } from './helpers';

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];

function sumHistory(s: GameState): number[] {
  return s.history.reduce((acc, h) => acc.map((v, i) => v + h.roundScores[i]), new Array(s.players.length).fill(0));
}

describe('complete computer-only games', () => {
  it.each([2, 3, 4])('%i players, every difficulty, multiple rounds, only legal actions, cards conserved', (players) => {
    for (let seed = 1; seed <= 12; seed++) {
      const seats = Array.from({ length: players }, (_, i) => DIFFICULTIES[(seed + i) % 3]);
      const end = autoplayGame(seed * 31 + players, seats, 3);
      expect(end.history).toHaveLength(3);
      expect(end.scores).toEqual(sumHistory(end));
      expect(end.winners.length).toBeGreaterThan(0);
    }
  });

  it.each(DIFFICULTIES)('%s: all-same-difficulty 4-player games finish', (d) => {
    for (let seed = 1; seed <= 6; seed++) autoplayGame(seed, [d, d, d, d], 2);
  });

  it('honours a score limit', () => {
    const end = autoplayGame(3, ['normal', 'hard', 'easy'], 0, { maxRounds: null, scoreLimit: 60 });
    expect(Math.max(...end.scores)).toBeGreaterThanOrEqual(60);
    expect(end.history.length).toBeGreaterThan(0);
  });
});

describe('difficulty strength (deterministic simulation)', () => {
  function averages(a: Difficulty, b: Difficulty, games: number): [number, number] {
    let x = 0;
    let y = 0;
    for (let g = 0; g < games; g++) {
      const swap = g % 2 === 1;
      const end = autoplayGame(1000 + g, swap ? [b, a] : [a, b], 5);
      x += swap ? end.scores[1] : end.scores[0];
      y += swap ? end.scores[0] : end.scores[1];
    }
    return [x / games, y / games];
  }

  it('Hard scores lower than Normal, and Normal lower than Easy', () => {
    const [hard, normalVsHard] = averages('hard', 'normal', 120);
    const [easy, normalVsEasy] = averages('easy', 'normal', 120);
    expect(hard).toBeLessThan(normalVsHard);
    expect(normalVsEasy).toBeLessThan(easy);
  });
});

describe('knowledge restrictions hold at every difficulty', () => {
  // Player 1's view is identical in both states; only cards hidden from player 1 differ.
  const a = rig(newGame(3), { hands: [[1, 2, 3, 4], [5, 6, 7, 8], [9, 9, 2, 2]], deck: [9, 9, 4], discard: [2] });
  const b = rig(newGame(3), { hands: [[14, 0, 3, 4], [12, 13, 7, 8], [0, 1, 2, 2]], deck: [1, 1, 13], discard: [2] });
  for (const s of [a, b]) s.round.current = 1;

  it.each(DIFFICULTIES)('%s makes identical decisions when only hidden cards differ', (d) => {
    expect(getPlayerView(a, 1)).toEqual(getPlayerView(b, 1));
    for (let seed = 0; seed < 20; seed++) {
      expect(decideAction(getPlayerView(a, 1), PROFILES[d], seed)).toEqual(decideAction(getPlayerView(b, 1), PROFILES[d], seed));
      expect(decideMatch(getPlayerView(a, 1), PROFILES[d], seed)).toEqual(decideMatch(getPlayerView(b, 1), PROFILES[d], seed));
    }
  });

  it('decisions are stable when asked repeatedly in the same situation', () => {
    const v = getPlayerView(a, 1);
    for (const d of DIFFICULTIES) expect(decideMatch(v, PROFILES[d], 5)).toEqual(decideMatch(v, PROFILES[d], 5));
  });
});

describe('difficulty behaviours', () => {
  it('Normal and Hard never guess a match they do not know', () => {
    const s = rig(newGame(2), { hands: [[7, 2, 3, 4], [7, 6, 1, 8]], deck: [9], discard: [7] });
    for (const d of ['normal', 'hard'] as const) {
      for (let seed = 0; seed < 50; seed++) expect(decideMatch(getPlayerView(s, 1), PROFILES[d], seed)).toBeNull();
    }
  });

  it('Easy sometimes guesses a match with an unknown card (a legal action that usually earns a penalty)', () => {
    const s = rig(newGame(2), { hands: [[7, 2, 3, 4], [7, 6, 1, 8]], deck: [9], discard: [7] });
    const guessy = { ...PROFILES.easy, wrongMatchChance: 1, missMatchChance: 0, forgetChance: 0 };
    const m = decideMatch(getPlayerView(s, 1), guessy, 1);
    expect(m).toMatchObject({ type: 'match', player: 1, target: { player: 1 } });
    expect([0, 1]).toContain((m as { target: { slot: number } }).target.slot); // only its unknown slots
    act(s, m!); // accepted by the engine
  });

  it('Easy only matches its own cards; Normal also matches known opponent cards', () => {
    const s = rig(newGame(2), { hands: [[7, 2, 3, 4], [5, 6, 1, 8]], deck: [9], discard: [7] });
    s.round.known[1].push(s.round.hands[0][0]!.id); // player 1 has seen player 0's 7
    const easy = { ...PROFILES.easy, missMatchChance: 0, wrongMatchChance: 0, forgetChance: 0 };
    expect(decideMatch(getPlayerView(s, 1), easy, 1)).toBeNull();
    expect(decideMatch(getPlayerView(s, 1), PROFILES.normal, 1)).toEqual({ type: 'match', player: 1, target: { player: 0, slot: 0 } });
  });

  it('Hard aims "look at others" at the opponent with the lowest estimated hand', () => {
    // 3 players; player 0 (Hard) peeks. Player 2 is known to hold low cards; player 1 high ones.
    let s = rig(newGame(3), { hands: [[5, 5, 5, 5], [12, 12, 12, 12], [0, 1, 1, 1]], deck: [9] });
    const k = s.round.known[0];
    k.push(s.round.hands[1][2]!.id, s.round.hands[1][3]!.id, s.round.hands[2][2]!.id, s.round.hands[2][3]!.id);
    s = act(s, { type: 'drawDeck', player: 0 }).state;
    s = act(s, { type: 'discardHeld', player: 0 }).state;
    expect(decideAction(getPlayerView(s, 0), PROFILES.hard, 1)).toMatchObject({ type: 'usePeek', target: { player: 2 } });
    expect(decideAction(getPlayerView(s, 0), PROFILES.normal, 1)).toMatchObject({ type: 'usePeek', target: { player: 1 } });
  });

  it('Hard estimates unknown cards from the cards it has not seen', () => {
    const s = rig(newGame(2), { hands: [[1, 2, -1, 0], [5, 6, 0, -1]], deck: [9], discard: [0] });
    const v = getPlayerView(s, 0);
    // It has seen -1, 0 and the 0 on the discard: the unseen average is higher than the deck average.
    expect(unseenAverage(v)).toBeGreaterThan(expectedUnknownValue(v));
  });

  it('Hard calls KOMBIO more patiently than Normal', () => {
    // Player 0 knows all four cards (total 5); opponent estimated ~25.
    const s = rig(newGame(2), { hands: [[1, 1, 1, 2], [5, 6, 7, 8]], deck: [9] });
    s.round.known[0] = s.round.hands[0].map((c) => c!.id);
    expect(decideAction(getPlayerView(s, 0), PROFILES.normal, 1)).toEqual({ type: 'callKombio', player: 0 });
    expect(decideAction(getPlayerView(s, 0), PROFILES.hard, 1)).not.toEqual({ type: 'callKombio', player: 0 });
  });

  it('every profile has UI pacing values', () => {
    for (const d of DIFFICULTIES) {
      expect(PROFILES[d].turnDelayMs).toBeGreaterThan(0);
      expect(PROFILES[d].matchDelayMs).toBeGreaterThan(0);
    }
    expect(PROFILES.hard.matchDelayMs).toBeLessThan(PROFILES.normal.matchDelayMs);
    expect(PROFILES.normal.matchDelayMs).toBeLessThan(PROFILES.easy.matchDelayMs);
  });
});
