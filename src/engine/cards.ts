/**
 * Card primitives.
 *
 * Every physical card has a stable numeric `id` for the lifetime of a game.
 * IDs are an engine-internal detail: they are never exposed for hidden cards
 * through the player-view interface (see view.ts), because IDs are assigned in
 * value order and would otherwise leak card values.
 */
export interface Card {
  readonly id: number;
  readonly value: number;
}

/** Card abilities, per the published rulebook ("Ability card values start at 7 and end at 14"). */
export type Ability =
  | 'peekOwn' // 7, 8: view one card in your hand
  | 'peekOpponent' // 9, 10: view one card in one opponent's hand
  | 'blindSwap' // 11, 12: swap any two cards on the table without viewing them
  | 'lookAndSwap' // 13: view any card, then optionally exchange it with another card (unviewed)
  | 'doubleLookAndSwap'; // 14: view any two cards, then optionally exchange them

export function abilityOf(value: number): Ability | null {
  switch (value) {
    case 7:
    case 8:
      return 'peekOwn';
    case 9:
    case 10:
      return 'peekOpponent';
    case 11:
    case 12:
      return 'blindSwap';
    case 13:
      return 'lookAndSwap';
    case 14:
      return 'doubleLookAndSwap';
    default:
      return null;
  }
}

export const ABILITY_LABELS: Record<Ability, string> = {
  peekOwn: 'Look at your own',
  peekOpponent: 'Look at others',
  blindSwap: 'Blind swap',
  lookAndSwap: 'Look & swap',
  doubleLookAndSwap: 'Double look & swap',
};
