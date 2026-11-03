import type { Card } from './cards';
import type { RulesConfig } from './rules';

export function handTotal(cards: readonly Card[]): number {
  return cards.reduce((sum, c) => sum + c.value, 0);
}

/** Hand score including the optional rulebook add-ons, when enabled. */
export function handScore(cards: readonly Card[], rules: RulesConfig): number {
  const total = handTotal(cards);
  const fourteens = cards.filter((c) => c.value === 14).length;
  if (rules.addOnDoubleFourteen && cards.length === 2 && fourteens === 2) return -15;
  if (rules.addOnFourteenTwentyFive && fourteens === 1 && total === 25) return -10;
  return total;
}

export interface RoundScore {
  /** Hand scores after add-ons, before caller adjustments. */
  handScores: number[];
  /** Points added to each player's cumulative score this round. */
  roundScores: number[];
  caller: number | null;
  /** True when the caller had the strictly lowest hand score. */
  callerWon: boolean | null;
}

/**
 * Rulebook scoring:
 * - Caller strictly lowest: caller receives their hand score; everyone else adds +10.
 * - One or more players ties or beats the caller: caller adds +15; everyone else receives their hand score.
 */
export function scoreRound(hands: readonly (readonly Card[])[], caller: number | null, rules: RulesConfig): RoundScore {
  const handScores = hands.map((h) => handScore(h, rules));
  if (caller === null) return { handScores, roundScores: handScores.slice(), caller, callerWon: null };
  const callerScore = handScores[caller];
  const callerWon = handScores.every((s, p) => p === caller || s > callerScore);
  const roundScores = handScores.map((s, p) => {
    if (callerWon) return p === caller ? s : s + rules.othersPenaltyWhenCallerWins;
    return p === caller ? s + rules.callerFailPenalty : s;
  });
  return { handScores, roundScores, caller, callerWon };
}
