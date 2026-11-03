import { describe, expect, it } from 'vitest';
import { getPlayerView } from '../src/engine';
import { act, cardCount, newGame, reject, rig } from './helpers';

describe('deck exhaustion', () => {
  it('reshuffles the discard pile (keeping its top card) when the deck runs out', () => {
    let s = rig(newGame(2), { hands: [[1, 2, 3, 4], [5, 6, 7, 8]], deck: [], discard: [9, 10, 11, 3] });
    const total = cardCount(s);
    const r = act(s, { type: 'drawDeck', player: 0 });
    s = r.state;
    expect(r.events.some((e) => e.type === 'reshuffled')).toBe(true);
    expect(s.round.discard.map((c) => c.value)).toEqual([3]);
    expect(s.round.deck).toHaveLength(2);
    expect(cardCount(s)).toBe(total);
  });

  it('forgets knowledge of reshuffled cards so it cannot leak when they are drawn again', () => {
    let s = rig(newGame(2), { hands: [[1, 2, 3, 4], [5, 6, 7, 8]], deck: [], discard: [9, 3] });
    const nine = s.round.discard[0].id;
    s.round.known[1].push(nine);
    s = act(s, { type: 'drawDeck', player: 0 }).state;
    expect(s.round.known[1]).not.toContain(nine);
  });

  it('cannot draw when deck is empty and the discard has one card; can still take it', () => {
    const s = rig(newGame(2), { hands: [[1, 2, 3, 4], [5, 6, 7, 8]], deck: [], discard: [3] });
    reject(s, { type: 'drawDeck', player: 0 });
    act(s, { type: 'takeDiscard', player: 0 });
  });

  it('a penalty with no card available is skipped, not invented', () => {
    let s = rig(newGame(2), { hands: [[1, 2, 3, 4], [5, 6, 7, 8]], deck: [], discard: [3] });
    const r = act(s, { type: 'match', player: 0, target: { player: 0, slot: 0 } });
    s = r.state;
    expect(r.events).toContainEqual({ type: 'penalty', player: 0, drawn: false });
    expect(s.round.hands[0]).toHaveLength(4);
  });

  it('with reshuffling disabled, an empty deck cannot be drawn from', () => {
    const s = rig(newGame(2, 1, { reshuffleDiscardWhenDeckEmpty: false }), { hands: [[1, 2, 3, 4], [5, 6, 7, 8]], deck: [], discard: [9, 3] });
    reject(s, { type: 'drawDeck', player: 0 });
  });

  it('pass is only legal when no draw, take or call is possible', () => {
    // Caller with an empty hand, empty deck, a single discard: no draw, no exchange, no call.
    let s = rig(newGame(2), { hands: [[], [1, 2, 3, 4]], deck: [], discard: [5] });
    s.round.caller = 0;
    reject(s, { type: 'callKombio', player: 0 });
    reject(s, { type: 'drawDeck', player: 0 });
    reject(s, { type: 'takeDiscard', player: 0 });
    expect(getPlayerView(s, 0).can.pass).toBe(true);
    s = act(s, { type: 'pass', player: 0 }).state;
    expect(s.round.current).toBe(1);
  });
});

describe('card visibility and the player view', () => {
  // `rules.deck` (public composition) is allowed; card IDs, deck order, knowledge sets and RNG state are not.
  const ALL_KEYS = /"id"|"known"|"rngState"|"attempts"|"card"/;

  it('exposes no card IDs, deck contents, knowledge sets or RNG state', () => {
    const s = newGame(3, 11);
    for (let p = 0; p < 3; p++) {
      const json = JSON.stringify(getPlayerView(s, p));
      expect(json).not.toMatch(ALL_KEYS);
      expect(Object.keys(getPlayerView(s, p))).not.toContain('deck');
    }
  });

  it('shows only values the viewer knows', () => {
    const s = rig(newGame(2), { hands: [[1, 2, 3, 4], [5, 6, 7, 8]], deck: [9] }, false);
    const v0 = getPlayerView(s, 0);
    expect(v0.hands[0].slots.map((x) => x.value)).toEqual([null, null, 3, 4]);
    expect(v0.hands[1].slots.map((x) => x.value)).toEqual([null, null, null, null]);
  });

  it('a deck-drawn card is visible only to the drawer; a discard-taken card to all', () => {
    let s = rig(newGame(2), { hands: [[1, 2, 3, 4], [5, 6, 7, 8]], deck: [9], discard: [0] });
    const drawn = act(s, { type: 'drawDeck', player: 0 }).state;
    expect(getPlayerView(drawn, 0).held!.value).toBe(9);
    expect(getPlayerView(drawn, 1).held!.value).toBeNull();
    s = act(s, { type: 'takeDiscard', player: 0 }).state;
    expect(getPlayerView(s, 1).held!.value).toBe(0);
  });

  it('views are identical when only hidden information differs', () => {
    const a = rig(newGame(2), { hands: [[1, 2, 3, 4], [5, 6, 7, 8]], deck: [9, 1, 2] });
    const b = rig(newGame(2), { hands: [[1, 2, 3, 4], [14, 13, 9, 8]], deck: [0, 12, 2] });
    expect(getPlayerView(a, 0)).toEqual(getPlayerView(b, 0));
    expect(getPlayerView(a, 1)).not.toEqual(getPlayerView(b, 1));
  });

  it('peeked values become visible only to the peeker', () => {
    let s = rig(newGame(2), { hands: [[1, 2, 3, 4], [5, 6, 7, 8]], deck: [9] });
    s = act(s, { type: 'drawDeck', player: 0 }).state;
    s = act(s, { type: 'discardHeld', player: 0 }).state;
    s = act(s, { type: 'usePeek', player: 0, target: { player: 1, slot: 0 } }).state;
    expect(getPlayerView(s, 0).hands[1].slots[0].value).toBe(5);
    expect(getPlayerView(s, 1).hands[1].slots[0].value).toBeNull();
  });

  it('all hands are revealed when the round ends', () => {
    let s = rig(newGame(2), { hands: [[1, 2, 3, 4], [5, 6, 7, 8]], deck: [9] });
    s = act(s, { type: 'callKombio', player: 0 }).state;
    s = act(s, { type: 'drawDeck', player: 1 }).state;
    s = act(s, { type: 'discardHeld', player: 1 }).state;
    s = act(s, { type: 'skipAbility', player: 1 }).state;
    expect(getPlayerView(s, 0).hands[1].slots.map((x) => x.value)).toEqual([5, 6, 7, 8]);
  });

  it('events never carry hidden values', () => {
    let s = rig(newGame(2), { hands: [[1, 2, 3, 4], [5, 6, 7, 8]], deck: [9] });
    const drew = act(s, { type: 'drawDeck', player: 0 });
    expect(drew.events).toContainEqual({ type: 'drew', player: 0, source: 'deck', value: null });
    s = act(drew.state, { type: 'discardHeld', player: 0 }).state;
    const peek = act(s, { type: 'usePeek', player: 0, target: { player: 1, slot: 0 } });
    expect(JSON.stringify(peek.events)).not.toContain('"value"');
  });
});
