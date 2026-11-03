import type { Ability } from './cards';
import type { SlotRef } from './actions';
import {
  canDrawFromDeck,
  handCards,
  hasMatchAttempt,
  isHandLocked,
  knows,
  locateCard,
  topDiscard,
  type GameState,
  type RoundResult,
} from './game';
import type { RulesConfig } from './rules';

export interface SlotView {
  slot: number;
  occupied: boolean;
  /** The card's value if the viewer is entitled to know it, otherwise null. */
  value: number | null;
}

export interface HandView {
  player: number;
  name: string;
  slots: SlotView[];
  cardCount: number;
  locked: boolean;
}

/**
 * Everything one player is allowed to know. It contains no card IDs, no deck
 * order, and no values the viewer has not legitimately seen. This is the only
 * game-state interface given to the UI and to computer opponents, and it is the
 * shape a future server would send to each client.
 */
export interface PlayerView {
  viewer: number;
  players: string[];
  rules: RulesConfig;
  scores: number[];
  roundNumber: number;
  phase: 'memorize' | 'playing' | 'ended';
  ready: boolean[];
  dealer: number;
  current: number;
  hands: HandView[];
  deckCount: number;
  discardCount: number;
  discardTop: number | null;
  /** The card held by the current player; value only visible to the holder or if it came from the discard pile. */
  held: { holder: number; source: 'deck' | 'discard'; value: number | null } | null;
  step: 'start' | 'holding' | 'ability';
  ability: { ability: Ability; stage: 'choose' | 'decide'; viewed: SlotRef[] } | null;
  interrupt:
    | { kind: 'give'; giver: number; receiver: number; slot: number }
    | { kind: 'mismatch'; owner: number; matcher: number; slot: number; value: number }
    | null;
  caller: number | null;
  finalTurnsRemaining: number[] | null;
  /** Convenience flags for the viewer. They mirror the engine's own validation. */
  can: {
    ready: boolean;
    drawDeck: boolean;
    takeDiscard: boolean;
    callKombio: boolean;
    pass: boolean;
    match: boolean;
  };
  lastResult: RoundResult | null;
  history: RoundResult[];
  gameOver: boolean;
  winners: number[];
}

export function getPlayerView(state: GameState, viewer: number): PlayerView {
  const r = state.round;
  const revealAll = r.phase === 'ended';
  const hands: HandView[] = r.hands.map((hand, player) => ({
    player,
    name: state.players[player],
    slots: hand.map((card, slot) => ({
      slot,
      occupied: card !== null,
      value: card !== null && (revealAll || knows(r, viewer, card.id)) ? card.value : null,
    })),
    cardCount: handCards(r, player).length,
    locked: isHandLocked(state, player),
  }));

  const step = r.step;
  const myTurn = r.phase === 'playing' && !r.interrupt && r.current === viewer && step.kind === 'start';
  const canTake = r.discard.length > 0 && handCards(r, viewer).length > 0;
  const top = topDiscard(r);

  let interrupt: PlayerView['interrupt'] = null;
  if (r.interrupt?.kind === 'give') {
    const { giver, receiver, slot } = r.interrupt;
    interrupt = { kind: 'give', giver, receiver, slot };
  } else if (r.interrupt?.kind === 'mismatch') {
    const { owner, matcher, slot } = r.interrupt;
    // The mismatched card was shown to the whole table.
    interrupt = { kind: 'mismatch', owner, matcher, slot, value: r.hands[owner][slot]!.value };
  }

  return {
    viewer,
    players: state.players.slice(),
    rules: structuredClone(state.rules),
    scores: state.scores.slice(),
    roundNumber: r.number,
    phase: r.phase,
    ready: r.ready.slice(),
    dealer: r.dealer,
    current: r.current,
    hands,
    deckCount: r.deck.length,
    discardCount: r.discard.length,
    discardTop: top ? top.value : null,
    held:
      step.kind === 'holding'
        ? {
            holder: r.current,
            source: step.source,
            value: r.current === viewer || step.source === 'discard' ? step.card.value : null,
          }
        : null,
    step: step.kind,
    ability:
      step.kind === 'ability'
        ? {
            ability: step.ability,
            stage: step.stage,
            // Which cards were looked at is public; their values are only in `hands` for those who know them.
            viewed: step.viewed.map((id) => locateCard(r, id)).filter((x): x is SlotRef => x !== null),
          }
        : null,
    interrupt,
    caller: r.caller,
    finalTurnsRemaining: r.finalQueue ? r.finalQueue.slice() : null,
    can: {
      ready: r.phase === 'memorize' && !r.ready[viewer],
      drawDeck: myTurn && canDrawFromDeck(state),
      takeDiscard: myTurn && canTake,
      callKombio: myTurn && r.caller === null,
      pass: myTurn && !canDrawFromDeck(state) && !canTake && r.caller !== null,
      match:
        r.phase === 'playing' &&
        !r.interrupt &&
        top !== null &&
        hasMatchAttempt(r, viewer) &&
        !(viewer === r.current && step.kind === 'holding'),
    },
    lastResult: r.result,
    history: structuredClone(state.history),
    gameOver: state.gameOver,
    winners: state.winners.slice(),
  };
}
