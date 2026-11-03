/** A position in a player's hand. Slots are stable: a matched-away card leaves an empty slot. */
export interface SlotRef {
  player: number;
  slot: number;
}

/**
 * Every state transition is one of these actions. Each names the acting player,
 * so the same interface works for local play and a future server that receives
 * actions from authenticated clients.
 */
export type Action =
  | { type: 'ready'; player: number }
  | { type: 'drawDeck'; player: number }
  | { type: 'takeDiscard'; player: number }
  | { type: 'replace'; player: number; slot: number }
  | { type: 'discardHeld'; player: number }
  | { type: 'usePeek'; player: number; target: SlotRef }
  | { type: 'useDoublePeek'; player: number; a: SlotRef; b: SlotRef }
  | { type: 'useSwap'; player: number; a: SlotRef; b: SlotRef }
  | { type: 'skipAbility'; player: number }
  | { type: 'callKombio'; player: number }
  | { type: 'pass'; player: number }
  | { type: 'match'; player: number; target: SlotRef }
  | { type: 'giveCard'; player: number; slot: number }
  | { type: 'declineGive'; player: number }
  | { type: 'resolveMismatch'; player: number; choice: 'matcherTakes' | 'returnAndPenalty' }
  | { type: 'nextRound'; player: number };

export type ActionType = Action['type'];
