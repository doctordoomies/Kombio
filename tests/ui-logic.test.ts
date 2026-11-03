import { describe, expect, it } from 'vitest';
import { getPlayerView } from '../src/engine';
import { seatPositions } from '../src/ui/board';
import { DEFAULT_SETTINGS, describeSettings, normalizeSettings, seatNames, settingsToRules } from '../src/ui/settings';
import { targetingFor } from '../src/ui/targeting';
import { act, newGame, rig } from './helpers';

describe('settings', () => {
  it('validates and clamps untrusted input', () => {
    expect(normalizeSettings({ players: '9', difficulty: 'impossible', length: 'x', rounds: -3, scoreLimit: 'abc' })).toEqual({
      ...DEFAULT_SETTINGS,
      players: 4,
      rounds: 1,
    });
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ players: 1 }).players).toBe(2);
  });

  it('maps game length to engine rules', () => {
    expect(settingsToRules({ ...DEFAULT_SETTINGS, length: 'unlimited' })).toEqual({ maxRounds: null, scoreLimit: null });
    expect(settingsToRules({ ...DEFAULT_SETTINGS, length: 'rounds', rounds: 7 })).toEqual({ maxRounds: 7, scoreLimit: null });
    expect(settingsToRules({ ...DEFAULT_SETTINGS, length: 'score', scoreLimit: 120 })).toEqual({ maxRounds: null, scoreLimit: 120 });
  });

  it('names seats and describes every setting', () => {
    const s = { ...DEFAULT_SETTINGS, players: 4, difficulty: 'hard' as const };
    expect(seatNames(s)).toEqual(['You', 'CPU 1', 'CPU 2', 'CPU 3']);
    expect(describeSettings(s).join('\n')).toMatch(/4 players[\s\S]*Hard[\s\S]*5 rounds/);
  });

  it('places opponents clockwise around the table', () => {
    expect(seatPositions(2)).toEqual(['top']);
    expect(seatPositions(3)).toEqual(['left', 'right']);
    expect(seatPositions(4)).toEqual(['left', 'top', 'right']);
  });
});

describe('targeting', () => {
  const noUi = { matchMode: false, pick: null };
  const hands = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]];

  function abilityState(card: number) {
    let s = rig(newGame(3), { hands, deck: [card, 0, 0] });
    s = act(s, { type: 'drawDeck', player: 0 }).state;
    return act(s, { type: 'discardHeld', player: 0 }).state;
  }

  it('nothing is targetable when it is not your turn and not in match mode', () => {
    const s = rig(newGame(3), { hands, deck: [1] });
    s.round.current = 1;
    expect(targetingFor(getPlayerView(s, 0), noUi).active).toBe(false);
  });

  it('holding a card targets only your own cards', () => {
    const s = act(rig(newGame(3), { hands, deck: [1] }), { type: 'drawDeck', player: 0 }).state;
    const t = targetingFor(getPlayerView(s, 0), noUi);
    expect(t.isTarget({ player: 0, slot: 2 })).toBe(true);
    expect(t.isTarget({ player: 1, slot: 0 })).toBe(false);
  });

  it('7/8 targets own cards, 9/10 opponents, 11–14 any card', () => {
    const own = targetingFor(getPlayerView(abilityState(7), 0), noUi);
    expect([own.isTarget({ player: 0, slot: 0 }), own.isTarget({ player: 2, slot: 0 })]).toEqual([true, false]);
    const opp = targetingFor(getPlayerView(abilityState(10), 0), noUi);
    expect([opp.isTarget({ player: 0, slot: 0 }), opp.isTarget({ player: 2, slot: 0 })]).toEqual([false, true]);
    for (const v of [11, 13, 14]) {
      const any = targetingFor(getPlayerView(abilityState(v), 0), noUi);
      expect([any.isTarget({ player: 0, slot: 0 }), any.isTarget({ player: 1, slot: 3 })]).toEqual([true, true]);
    }
  });

  it('13 decide stage excludes the viewed card', () => {
    const s = act(abilityState(13), { type: 'usePeek', player: 0, target: { player: 1, slot: 1 } }).state;
    const t = targetingFor(getPlayerView(s, 0), noUi);
    expect(t.isTarget({ player: 1, slot: 1 })).toBe(false);
    expect(t.isTarget({ player: 0, slot: 0 })).toBe(true);
  });

  it("match mode targets any occupied card but not a locked KOMBIO caller's hand", () => {
    let s = rig(newGame(3), { hands, deck: [6, 6, 6], discard: [4] });
    s = act(s, { type: 'callKombio', player: 0 }).state;
    const t = targetingFor(getPlayerView(s, 1), { matchMode: true, pick: null });
    expect(t.isTarget({ player: 2, slot: 0 })).toBe(true);
    expect(t.isTarget({ player: 0, slot: 0 })).toBe(false);
    expect(t.invalidHint).toMatch(/locked/);
  });
});
