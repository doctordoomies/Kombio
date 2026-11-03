import { abilityOf, type Ability, type Card } from './cards';
import type { Action, SlotRef } from './actions';
import { buildDeck, shuffle } from './deck';
import { mulberry32Next } from './rng';
import { MAX_PLAYERS, MIN_PLAYERS, resolveRules, type RulesConfig } from './rules';
import { scoreRound, type RoundScore } from './scoring';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type Step =
  /** Current player must draw from the deck, take the discard, call KOMBIO, or (rarely) pass. */
  | { kind: 'start' }
  /** Current player holds a card and must replace a hand card with it (or discard it, if from the deck). */
  | { kind: 'holding'; card: Card; source: 'deck' | 'discard' }
  /**
   * Current player discarded an ability card drawn from the deck.
   * `choose`: pick target(s). `decide`: (13/14 only) choose whether to exchange the viewed card(s).
   * `viewed` holds card IDs so references survive matches that happen meanwhile.
   */
  | { kind: 'ability'; ability: Ability; stage: 'choose' | 'decide'; viewed: number[] };

/** Out-of-turn decisions that block every other action until resolved. */
export type Interrupt =
  /** `giver` successfully matched a card from `receiver`'s hand and may fill the empty slot. */
  | { kind: 'give'; giver: number; receiver: number; slot: number }
  /** `matcher` wrongly attempted a match with `owner`'s card; the owner chooses the consequence. */
  | { kind: 'mismatch'; owner: number; matcher: number; slot: number };

export interface RoundResult extends RoundScore {
  round: number;
  /** Final revealed hands (values only). */
  hands: number[][];
}

export interface RoundState {
  number: number;
  dealer: number;
  phase: 'memorize' | 'playing' | 'ended';
  ready: boolean[];
  /** hands[player][slot]; null = empty slot (card was matched away). */
  hands: (Card | null)[][];
  /** Draw pile; the last element is the top. */
  deck: Card[];
  /** Discard pile; the last element is the face-up top card. */
  discard: Card[];
  /** known[player] = IDs of cards whose value that player has legitimately seen. */
  known: number[][];
  current: number;
  step: Step;
  interrupt: Interrupt | null;
  /** Players who already attempted a match against the discard whose top card ID is `attemptTop`. */
  attempts: number[];
  attemptTop: number | null;
  caller: number | null;
  /** Players still owed a final turn after a KOMBIO call; built when the calling turn ends. */
  finalQueue: number[] | null;
  result: RoundResult | null;
}

export interface GameState {
  rules: RulesConfig;
  players: string[];
  scores: number[];
  history: RoundResult[];
  round: RoundState;
  rngState: number;
  gameOver: boolean;
  winners: number[];
}

// ---------------------------------------------------------------------------
// Events (public: they never contain hidden card values)
// ---------------------------------------------------------------------------

export type GameEvent =
  | { type: 'roundStarted'; round: number; dealer: number; first: number }
  | { type: 'ready'; player: number }
  | { type: 'turnStarted'; player: number; final: boolean }
  | { type: 'reshuffled'; count: number }
  | { type: 'drew'; player: number; source: 'deck' | 'discard'; value: number | null }
  | { type: 'replaced'; player: number; slot: number; discarded: number }
  | { type: 'discarded'; player: number; value: number; ability: Ability | null }
  | { type: 'peeked'; player: number; targets: SlotRef[] }
  | { type: 'swapped'; player: number; a: SlotRef; b: SlotRef }
  | { type: 'abilitySkipped'; player: number }
  | { type: 'matched'; player: number; target: SlotRef; value: number }
  | { type: 'mismatched'; player: number; target: SlotRef; value: number; topValue: number }
  | { type: 'penalty'; player: number; drawn: boolean }
  | { type: 'mismatchResolved'; owner: number; matcher: number; choice: 'matcherTakes' | 'returnAndPenalty' }
  | { type: 'gave'; player: number; to: number; slot: number }
  | { type: 'declinedGive'; player: number }
  | { type: 'kombio'; player: number; automatic: boolean }
  | { type: 'passed'; player: number }
  | { type: 'roundEnded'; result: RoundResult }
  | { type: 'gameOver'; winners: number[]; scores: number[] };

export type ActionResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; state: GameState; error: string };

export class IllegalActionError extends Error {}

function fail(message: string): never {
  throw new IllegalActionError(message);
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export interface NewGameOptions {
  players: string[];
  seed: number;
  rules?: Partial<RulesConfig>;
}

export function createGame(options: NewGameOptions): { state: GameState; events: GameEvent[] } {
  const rules = resolveRules(options.rules);
  const n = options.players.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new Error(`KOMBIO needs ${MIN_PLAYERS}-${MAX_PLAYERS} players`);
  const needed = n * rules.handSize + (rules.initialDiscard ? 1 : 0);
  const deckSize = rules.deck.reduce((s, e) => s + e.count, 0);
  if (deckSize < needed) throw new Error('deck too small for this many players');
  const state: GameState = {
    rules,
    players: options.players.slice(),
    scores: new Array(n).fill(0),
    history: [],
    // Dealer starts as the last player so player 0 (left of the dealer) takes the first turn.
    round: undefined as unknown as RoundState,
    rngState: options.seed | 0,
    gameOver: false,
    winners: [],
  };
  const events: GameEvent[] = [];
  startRound(state, 1, n - 1, events);
  return { state, events };
}

function random(state: GameState): number {
  const r = mulberry32Next(state.rngState);
  state.rngState = r.state;
  return r.value;
}

function startRound(state: GameState, number: number, dealer: number, events: GameEvent[]): void {
  const n = state.players.length;
  const { rules } = state;
  const deck = shuffle(buildDeck(rules.deck), () => random(state));
  const hands: (Card | null)[][] = Array.from({ length: n }, () => []);
  // Deal one card at a time, starting left of the dealer.
  for (let i = 0; i < rules.handSize; i++) {
    for (let k = 1; k <= n; k++) hands[(dealer + k) % n].push(deck.pop()!);
  }
  const known = hands.map((h) => rules.initialPeekSlots.map((s) => h[s]!.id));
  const discard: Card[] = [];
  if (rules.initialDiscard) discard.push(deck.pop()!);
  const first = (dealer + 1) % n;
  state.round = {
    number,
    dealer,
    phase: 'memorize',
    ready: new Array(n).fill(false),
    hands,
    deck,
    discard,
    known,
    current: first,
    step: { kind: 'start' },
    interrupt: null,
    attempts: [],
    attemptTop: null,
    caller: null,
    finalQueue: null,
    result: null,
  };
  events.push({ type: 'roundStarted', round: number, dealer, first });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function handCards(round: RoundState, player: number): Card[] {
  return round.hands[player].filter((c): c is Card => c !== null);
}

export function knows(round: RoundState, player: number, cardId: number): boolean {
  return round.known[player].includes(cardId);
}

export function isHandLocked(state: GameState, player: number): boolean {
  const { caller } = state.round;
  if (caller !== player) return false;
  switch (state.rules.lockCallerHand) {
    case 'always':
      return true;
    case 'multiplayerOnly':
      return state.players.length > 2;
    default:
      return false;
  }
}

export function topDiscard(round: RoundState): Card | null {
  return round.discard.at(-1) ?? null;
}

/** True when `player` may still attempt a match against the current top discard. */
export function hasMatchAttempt(round: RoundState, player: number): boolean {
  const top = topDiscard(round);
  if (!top) return false;
  return !(round.attemptTop === top.id && round.attempts.includes(player));
}

export function canDrawFromDeck(state: GameState): boolean {
  const r = state.round;
  return r.deck.length > 0 || (state.rules.reshuffleDiscardWhenDeckEmpty && r.discard.length > 1);
}

export function locateCard(round: RoundState, cardId: number): SlotRef | null {
  for (let p = 0; p < round.hands.length; p++) {
    const slot = round.hands[p].findIndex((c) => c?.id === cardId);
    if (slot >= 0) return { player: p, slot };
  }
  return null;
}

/** Validates an action without exposing the resulting state. */
export function isLegal(state: GameState, action: Action): boolean {
  return applyAction(state, action).ok;
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/**
 * Applies an action. Illegal actions return `{ ok: false }` and the original,
 * untouched state: the reducer works on a deep copy, so a rejected action can
 * never leave a half-applied state behind.
 */
export function applyAction(state: GameState, action: Action): ActionResult {
  const next = structuredClone(state);
  const events: GameEvent[] = [];
  try {
    reduce(next, action, events);
  } catch (e) {
    if (e instanceof IllegalActionError) return { ok: false, state, error: e.message };
    throw e;
  }
  return { ok: true, state: next, events };
}

function reduce(state: GameState, action: Action, events: GameEvent[]): void {
  const r = state.round;
  const p = action.player;
  if (!Number.isInteger(p) || p < 0 || p >= state.players.length) fail('Unknown player.');
  if (state.gameOver) fail('The game is over.');

  if (action.type === 'nextRound') {
    if (r.phase !== 'ended') fail('The round is still in progress.');
    startRound(state, r.number + 1, (r.dealer + 1) % state.players.length, events);
    return;
  }
  if (r.phase === 'ended') fail('The round has ended.');

  if (action.type === 'ready') {
    if (r.phase !== 'memorize') fail('Not in the memorization phase.');
    if (r.ready[p]) fail('Already ready.');
    r.ready[p] = true;
    events.push({ type: 'ready', player: p });
    if (r.ready.every(Boolean)) {
      r.phase = 'playing';
      events.push({ type: 'turnStarted', player: r.current, final: false });
    }
    return;
  }
  if (r.phase !== 'playing') fail('Players are still memorizing their cards.');

  // Interrupt responses.
  if (action.type === 'giveCard' || action.type === 'declineGive') {
    const it = r.interrupt;
    if (it?.kind !== 'give' || it.giver !== p) fail('No card to give.');
    if (action.type === 'declineGive') {
      if (state.rules.giveAfterOpponentMatch === 'required') fail('You must give a card.');
      events.push({ type: 'declinedGive', player: p });
    } else {
      const card = r.hands[p][action.slot];
      if (!card) fail('Choose a card from your hand.');
      r.hands[p][action.slot] = null;
      r.hands[it.receiver][it.slot] = card;
      events.push({ type: 'gave', player: p, to: it.receiver, slot: it.slot });
    }
    r.interrupt = null;
    checkAutomaticKombio(state, p, events);
    return;
  }
  if (action.type === 'resolveMismatch') {
    const it = r.interrupt;
    if (it?.kind !== 'mismatch' || it.owner !== p) fail('Nothing to resolve.');
    if (action.choice === 'matcherTakes') {
      const card = r.hands[it.owner][it.slot]!;
      r.hands[it.owner][it.slot] = null;
      r.hands[it.matcher].push(card);
    } else {
      givePenaltyCard(state, it.matcher, events);
    }
    events.push({ type: 'mismatchResolved', owner: it.owner, matcher: it.matcher, choice: action.choice });
    r.interrupt = null;
    checkAutomaticKombio(state, p, events);
    return;
  }
  if (r.interrupt) fail('Waiting for another player to decide.');

  if (action.type === 'match') {
    doMatch(state, p, action.target, events);
    return;
  }

  // Everything below is a turn action.
  if (p !== r.current) fail('It is not your turn.');
  const step = r.step;

  switch (action.type) {
    case 'drawDeck': {
      if (step.kind !== 'start') fail('You cannot draw now.');
      const card = drawCard(state, events);
      if (!card) fail('The deck is empty.');
      learn(r, p, card.id);
      r.step = { kind: 'holding', card, source: 'deck' };
      events.push({ type: 'drew', player: p, source: 'deck', value: null });
      return;
    }
    case 'takeDiscard': {
      if (step.kind !== 'start') fail('You cannot take the discard now.');
      if (handCards(r, p).length === 0) fail('You have no card to exchange.');
      const card = r.discard.pop();
      if (!card) fail('The discard pile is empty.');
      for (let q = 0; q < state.players.length; q++) learn(r, q, card.id); // it was face up
      r.step = { kind: 'holding', card, source: 'discard' };
      events.push({ type: 'drew', player: p, source: 'discard', value: card.value });
      return;
    }
    case 'replace': {
      if (step.kind !== 'holding') fail('You are not holding a card.');
      const old = r.hands[p][action.slot];
      if (!old) fail('Choose one of your cards to replace.');
      r.hands[p][action.slot] = step.card;
      r.discard.push(old);
      events.push({ type: 'replaced', player: p, slot: action.slot, discarded: old.value });
      endTurn(state, events);
      return;
    }
    case 'discardHeld': {
      if (step.kind !== 'holding') fail('You are not holding a card.');
      if (step.source !== 'deck') fail('A card taken from the discard pile must be exchanged.');
      r.discard.push(step.card);
      const ability = abilityOf(step.card.value);
      events.push({ type: 'discarded', player: p, value: step.card.value, ability });
      if (ability) r.step = { kind: 'ability', ability, stage: 'choose', viewed: [] };
      else endTurn(state, events);
      return;
    }
    case 'usePeek': {
      if (step.kind !== 'ability' || step.stage !== 'choose') fail('No ability to use.');
      const { ability } = step;
      if (ability !== 'peekOwn' && ability !== 'peekOpponent' && ability !== 'lookAndSwap') fail('This ability does not peek one card.');
      if (ability === 'peekOwn' && action.target.player !== p) fail('Choose one of your own cards.');
      if (ability === 'peekOpponent' && action.target.player === p) fail("Choose an opponent's card.");
      const card = targetCard(state, action.target);
      learn(r, p, card.id);
      events.push({ type: 'peeked', player: p, targets: [action.target] });
      if (ability === 'lookAndSwap') r.step = { ...step, stage: 'decide', viewed: [card.id] };
      else endTurn(state, events);
      return;
    }
    case 'useDoublePeek': {
      if (step.kind !== 'ability' || step.stage !== 'choose' || step.ability !== 'doubleLookAndSwap') fail('No double look available.');
      if (sameSlot(action.a, action.b)) fail('Choose two different cards.');
      const a = targetCard(state, action.a);
      const b = targetCard(state, action.b);
      learn(r, p, a.id);
      learn(r, p, b.id);
      events.push({ type: 'peeked', player: p, targets: [action.a, action.b] });
      r.step = { ...step, stage: 'decide', viewed: [a.id, b.id] };
      return;
    }
    case 'useSwap': {
      if (step.kind !== 'ability') fail('No ability to use.');
      if (sameSlot(action.a, action.b)) fail('Choose two different cards.');
      const a = targetCard(state, action.a);
      const b = targetCard(state, action.b);
      if (step.ability === 'blindSwap') {
        if (step.stage !== 'choose') fail('Invalid ability stage.');
      } else if (step.ability === 'lookAndSwap') {
        if (step.stage !== 'decide') fail('Look at a card first.');
        if (a.id !== step.viewed[0] && b.id !== step.viewed[0]) fail('One of the cards must be the card you looked at.');
      } else if (step.ability === 'doubleLookAndSwap') {
        if (step.stage !== 'decide') fail('Look at two cards first.');
        if (!step.viewed.includes(a.id) || !step.viewed.includes(b.id)) fail('You can only exchange the two cards you looked at.');
      } else {
        fail('This ability does not swap cards.');
      }
      swapSlots(r, action.a, action.b);
      events.push({ type: 'swapped', player: p, a: action.a, b: action.b });
      endTurn(state, events);
      return;
    }
    case 'skipAbility': {
      if (step.kind !== 'ability') fail('No ability to skip.');
      events.push({ type: 'abilitySkipped', player: p });
      endTurn(state, events);
      return;
    }
    case 'callKombio': {
      if (step.kind !== 'start') fail('KOMBIO can only be called in place of a turn.');
      if (r.caller !== null) fail('KOMBIO has already been called.');
      r.caller = p;
      events.push({ type: 'kombio', player: p, automatic: false });
      endTurn(state, events);
      return;
    }
    case 'pass': {
      if (step.kind !== 'start') fail('You cannot pass now.');
      const canTake = r.discard.length > 0 && handCards(r, p).length > 0;
      if (canDrawFromDeck(state) || canTake || r.caller === null) fail('You have a legal move; passing is not allowed.');
      events.push({ type: 'passed', player: p });
      endTurn(state, events);
      return;
    }
  }
  fail('Unknown action.');
}

function doMatch(state: GameState, p: number, target: SlotRef, events: GameEvent[]): void {
  const r = state.round;
  const top = topDiscard(r);
  if (!top) fail('There is no discarded card to match.');
  if (!hasMatchAttempt(r, p)) fail('You already attempted a match on this discard.');
  // Engine interpretation of "players can only use one physical hand": the turn
  // player cannot match while holding a drawn card.
  if (p === r.current && r.step.kind === 'holding') fail('Finish placing the card you are holding first.');
  const card = targetCard(state, target);

  if (r.attemptTop !== top.id) {
    r.attemptTop = top.id;
    r.attempts = [];
  }
  r.attempts.push(p);

  if (card.value === top.value) {
    r.hands[target.player][target.slot] = null;
    r.discard.push(card);
    events.push({ type: 'matched', player: p, target, value: card.value });
    if (target.player !== p && handCards(r, p).length > 0) {
      r.interrupt = { kind: 'give', giver: p, receiver: target.player, slot: target.slot };
      return;
    }
    checkAutomaticKombio(state, p, events);
    return;
  }

  // Incorrect attempts are shown to the whole table.
  for (let q = 0; q < state.players.length; q++) learn(r, q, card.id);
  events.push({ type: 'mismatched', player: p, target, value: card.value, topValue: top.value });
  if (target.player === p) givePenaltyCard(state, p, events);
  else r.interrupt = { kind: 'mismatch', owner: target.player, matcher: p, slot: target.slot };
}

/** Rulebook: "Reducing your hand to zero cards is an automatic KOMBIO call." */
function checkAutomaticKombio(state: GameState, actor: number, events: GameEvent[]): void {
  const r = state.round;
  if (r.caller !== null) return;
  const n = state.players.length;
  for (let k = 0; k < n; k++) {
    const q = (actor + k) % n;
    if (handCards(r, q).length === 0) {
      r.caller = q;
      events.push({ type: 'kombio', player: q, automatic: true });
      // The in-progress turn continues; final turns begin when it ends.
      return;
    }
  }
}

function givePenaltyCard(state: GameState, player: number, events: GameEvent[]): void {
  const card = drawCard(state, events);
  if (card) state.round.hands[player].push(card); // added face down, unseen by anyone
  events.push({ type: 'penalty', player, drawn: card !== null });
}

function drawCard(state: GameState, events: GameEvent[]): Card | null {
  const r = state.round;
  if (r.deck.length === 0 && state.rules.reshuffleDiscardWhenDeckEmpty && r.discard.length > 1) {
    const top = r.discard.pop()!;
    const reshuffled = shuffle(r.discard, () => random(state));
    // Positions in a shuffled deck are unknown to everyone: forget these cards.
    const ids = new Set(reshuffled.map((c) => c.id));
    r.known = r.known.map((k) => k.filter((id) => !ids.has(id)));
    r.deck = reshuffled;
    r.discard = [top];
    events.push({ type: 'reshuffled', count: reshuffled.length });
  }
  return r.deck.pop() ?? null;
}

function endTurn(state: GameState, events: GameEvent[]): void {
  const r = state.round;
  const n = state.players.length;
  r.step = { kind: 'start' };
  if (r.caller === null) {
    r.current = (r.current + 1) % n;
    events.push({ type: 'turnStarted', player: r.current, final: false });
    return;
  }
  if (r.finalQueue === null) {
    // Every player except the caller gets exactly one more full turn, clockwise.
    r.finalQueue = [];
    for (let k = 1; k <= n; k++) {
      const q = (r.current + k) % n;
      if (q !== r.caller) r.finalQueue.push(q);
    }
  }
  const next = r.finalQueue.shift();
  if (next === undefined) {
    endRound(state, events);
    return;
  }
  r.current = next;
  events.push({ type: 'turnStarted', player: next, final: true });
}

function endRound(state: GameState, events: GameEvent[]): void {
  const r = state.round;
  r.phase = 'ended';
  const hands = r.hands.map((h) => h.filter((c): c is Card => c !== null));
  const score = scoreRound(hands, r.caller, state.rules);
  const result: RoundResult = { ...score, round: r.number, hands: hands.map((h) => h.map((c) => c.value)) };
  r.result = result;
  state.history.push(result);
  state.scores = state.scores.map((s, i) => s + score.roundScores[i]);
  events.push({ type: 'roundEnded', result });
  const { maxRounds, scoreLimit } = state.rules;
  if ((maxRounds !== null && r.number >= maxRounds) || (scoreLimit !== null && state.scores.some((s) => s >= scoreLimit))) {
    state.gameOver = true;
    const best = Math.min(...state.scores);
    state.winners = state.scores.flatMap((s, i) => (s === best ? [i] : []));
    events.push({ type: 'gameOver', winners: state.winners, scores: state.scores.slice() });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function learn(r: RoundState, player: number, cardId: number): void {
  if (!r.known[player].includes(cardId)) r.known[player].push(cardId);
}

function sameSlot(a: SlotRef, b: SlotRef): boolean {
  return a.player === b.player && a.slot === b.slot;
}

/** Resolves a target slot, enforcing that it holds a card and is not in a locked hand. */
function targetCard(state: GameState, ref: SlotRef): Card {
  const hand = state.round.hands[ref?.player];
  if (!hand) fail('No such player.');
  const card = hand[ref.slot];
  if (!card) fail('There is no card there.');
  if (isHandLocked(state, ref.player)) fail("The KOMBIO caller's hand is locked.");
  return card;
}

function swapSlots(r: RoundState, a: SlotRef, b: SlotRef): void {
  const x = r.hands[a.player][a.slot];
  r.hands[a.player][a.slot] = r.hands[b.player][b.slot];
  r.hands[b.player][b.slot] = x;
  // Knowledge follows the card: everyone sees which positions were swapped.
}
