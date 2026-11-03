import { ABILITY_LABELS } from '../engine/cards';
import type { GameEvent } from '../engine/game';

/** Formats a public engine event for the game log. Events never contain hidden values. */
export function describeEvent(e: GameEvent, names: string[]): string | null {
  const n = (p: number) => names[p];
  switch (e.type) {
    case 'roundStarted':
      return `Round ${e.round} started — first turn: ${n(e.first)}`;
    case 'drew':
      return e.source === 'deck' ? `${n(e.player)} drew from the deck` : `${n(e.player)} took the ${e.value} from the discard pile`;
    case 'reshuffled':
      return `Deck empty: ${e.count} discards reshuffled into a new deck`;
    case 'replaced':
      return `${n(e.player)} exchanged card ${e.slot + 1} and discarded a ${e.discarded}`;
    case 'discarded':
      return `${n(e.player)} discarded a ${e.value}${e.ability ? ` (${ABILITY_LABELS[e.ability]})` : ''}`;
    case 'peeked':
      return `${n(e.player)} looked at ${e.targets.map((t) => `${n(t.player)}'s card ${t.slot + 1}`).join(' and ')}`;
    case 'swapped':
      return `${n(e.player)} swapped ${n(e.a.player)}'s card ${e.a.slot + 1} with ${n(e.b.player)}'s card ${e.b.slot + 1}`;
    case 'abilitySkipped':
      return `${n(e.player)} did not use the ability`;
    case 'matched':
      return `${n(e.player)} matched ${n(e.target.player)}'s card ${e.target.slot + 1} (${e.value})`;
    case 'mismatched':
      return `${n(e.player)} tried to match ${n(e.target.player)}'s card ${e.target.slot + 1} — it was a ${e.value}, not a ${e.topValue}`;
    case 'penalty':
      return e.drawn ? `Penalty card for ${n(e.player)}` : `No card left for ${n(e.player)}'s penalty`;
    case 'mismatchResolved':
      return e.choice === 'matcherTakes'
        ? `${n(e.owner)} made ${n(e.matcher)} take the mismatched card`
        : `${n(e.owner)} took the card back; penalty card for ${n(e.matcher)}`;
    case 'gave':
      return `${n(e.player)} gave ${n(e.to)} a card`;
    case 'declinedGive':
      return `${n(e.player)} chose not to give a card`;
    case 'kombio':
      return e.automatic ? `Automatic KOMBIO: ${n(e.player)} emptied their hand!` : `${n(e.player)} called KOMBIO!`;
    case 'passed':
      return `${n(e.player)} had no legal move and passed`;
    case 'roundEnded':
      return `Round ${e.result.round} scores: ${e.result.roundScores.map((s, i) => `${n(i)} ${s}`).join(', ')}`;
    case 'gameOver':
      return `Game over — winner: ${e.winners.map(n).join(' & ')}`;
    default:
      return null;
  }
}
