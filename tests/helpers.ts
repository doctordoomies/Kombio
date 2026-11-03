import { decideAction, decideMatch, PROFILES, type Difficulty } from '../src/ai/opponent';
import { applyAction, createGame, getPlayerView, type Action, type GameEvent, type GameState, type RulesConfig } from '../src/engine';

export function newGame(players = 2, seed = 1, rules: Partial<RulesConfig> = {}): GameState {
  return createGame({ players: Array.from({ length: players }, (_, i) => `P${i}`), seed, rules }).state;
}

/** Applies an action and fails the test if it is rejected. */
export function act(state: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  const r = applyAction(state, action);
  if (!r.ok) throw new Error(`Action ${JSON.stringify(action)} rejected: ${r.error}`);
  return { state: r.state, events: r.events };
}

/** Expects an action to be rejected and the state to be unchanged. */
export function reject(state: GameState, action: Action): string {
  const before = JSON.stringify(state);
  const r = applyAction(state, action);
  if (r.ok) throw new Error(`Action ${JSON.stringify(action)} was unexpectedly accepted`);
  if (JSON.stringify(r.state) !== before || JSON.stringify(state) !== before) throw new Error('rejected action mutated state');
  return r.error;
}

export function readyAll(state: GameState): GameState {
  let s = state;
  for (let p = 0; p < s.players.length; p++) s = act(s, { type: 'ready', player: p }).state;
  return s;
}

export interface Layout {
  hands: number[][];
  /** Listed top-first: deck[0] is the next card drawn. */
  deck?: number[];
  /** Listed bottom-first: the last value is the face-up top. */
  discard?: number[];
}

/**
 * Replaces the dealt cards with an exact layout (fresh, unique card IDs) and
 * resets knowledge to the standard initial peek. Leaves the round in the
 * memorize phase unless `play` is true.
 */
export function rig(state: GameState, layout: Layout, play = true): GameState {
  const s = structuredClone(state);
  let id = 1000;
  const mk = (value: number) => ({ id: ++id, value });
  const r = s.round;
  r.hands = layout.hands.map((h) => h.map(mk));
  r.deck = (layout.deck ?? []).map(mk).reverse();
  r.discard = (layout.discard ?? []).map(mk);
  r.known = r.hands.map((h) => s.rules.initialPeekSlots.filter((i) => h[i]).map((i) => h[i]!.id));
  r.attempts = [];
  r.attemptTop = null;
  return play ? readyAll(s) : s;
}

export function values(state: GameState, player: number): (number | null)[] {
  return state.round.hands[player].map((c) => (c ? c.value : null));
}

/** Total number of cards in the round; must be conserved by every action. */
export function cardCount(state: GameState): number {
  const r = state.round;
  const held = r.step.kind === 'holding' ? 1 : 0;
  return r.deck.length + r.discard.length + held + r.hands.flat().filter(Boolean).length;
}

/**
 * Plays a complete game with computer players only. Every action goes through
 * the engine's validation; card conservation is checked after every action.
 */
export function autoplayGame(seed: number, seats: Difficulty[], rounds: number, rules: Partial<RulesConfig> = {}): GameState {
  let { state } = createGame({ players: seats.map((d, i) => `${d}${i}`), seed, rules: { maxRounds: rounds, ...rules } });
  const total = cardCount(state);
  for (let i = 0; i < 50000 && !state.gameOver; i++) {
    if (state.round.phase === 'ended') {
      state = act(state, { type: 'nextRound', player: 0 }).state;
      continue;
    }
    let action: Action | null = null;
    for (let p = 0; p < seats.length && !action; p++) action = decideMatch(getPlayerView(state, p), PROFILES[seats[p]], seed + p);
    for (let p = 0; p < seats.length && !action; p++) action = decideAction(getPlayerView(state, p), PROFILES[seats[p]], seed + p);
    if (!action) throw new Error(`no player could act (seed ${seed}, step ${i})`);
    const r = applyAction(state, action);
    if (!r.ok) throw new Error(`AI chose illegal ${JSON.stringify(action)}: ${r.error} (seed ${seed})`);
    state = r.state;
    if (state.round.phase !== 'ended' && cardCount(state) !== total) throw new Error(`card count changed (seed ${seed})`);
  }
  if (!state.gameOver) throw new Error(`game did not finish (seed ${seed})`);
  return state;
}
