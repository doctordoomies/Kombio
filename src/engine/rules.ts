import type { DeckEntry } from './deck';

/**
 * Rule configuration.
 *
 * Source of truth: the publisher's two-page "KOMBIO RULES" sheet (kombiocards.com).
 * Settings marked UNVERIFIED are not covered by that sheet; their defaults
 * preserve the existing prototype's behaviour or are engine interpretations.
 * See docs/RULES.md for the full verification table.
 */
export interface RulesConfig {
  /**
   * UNVERIFIED per-value counts. The rulebook only says ability cards are 7–14 and
   * implies exactly two 14s. Retail listings describe 36 "kombio" + 34 action
   * cards (70 total); this default (from the prototype) matches those totals:
   * -1 ×3, 0 ×3, 1–12 ×5, 13 ×2, 14 ×2.
   */
  deck: DeckEntry[];
  /** Rulebook: "Deal four cards, face down, to each player in a 2x2 grid." */
  handSize: number;
  /** Rulebook: players "can view their bottom two cards once" (slots 2 and 3 of the 2x2 grid). */
  initialPeekSlots: number[];
  /**
   * Rulebook: on the first turn the player draws and discards "next to the deck",
   * which implies the discard pile starts empty. The prototype flipped one card;
   * set true to restore that.
   */
  initialDiscard: boolean;
  /** Rulebook: caller is not lowest (tie or beaten) -> caller +15. */
  callerFailPenalty: number;
  /** Rulebook: caller is strictly lowest -> everyone else +10. */
  othersPenaltyWhenCallerWins: number;
  /**
   * Rulebook: "The KOMBIO Caller's hand is locked from viewing, matching and
   * swapping" and "If playing 1v1, the KOMBIO Caller's hand is not locked."
   */
  lockCallerHand: 'never' | 'multiplayerOnly' | 'always';
  /**
   * Rulebook: after matching an opponent's card "you CAN choose a card from your
   * hand to replace" it. Read literally as optional.
   */
  giveAfterOpponentMatch: 'optional' | 'required';
  /** UNVERIFIED: when the deck is empty, shuffle the discard pile (except its top card) into a new deck. */
  reshuffleDiscardWhenDeckEmpty: boolean;
  /** Rulebook ADD-ON (optional variant): exactly two 14s and nothing else scores -15. */
  addOnDoubleFourteen: boolean;
  /**
   * Rulebook ADD-ON (optional variant): one 14 plus cards totalling exactly 25
   * scores -10. Interpreted as: the whole hand (including the 14) totals 25.
   */
  addOnFourteenTwentyFive: boolean;
  /** Rulebook: "Play to a set number of rounds or set value." null = no limit. */
  maxRounds: number | null;
  scoreLimit: number | null;
}

export const DEFAULT_DECK: DeckEntry[] = [
  { value: -1, count: 3 },
  { value: 0, count: 3 },
  ...Array.from({ length: 12 }, (_, i) => ({ value: i + 1, count: 5 })),
  { value: 13, count: 2 },
  { value: 14, count: 2 },
];

export const DEFAULT_RULES: RulesConfig = {
  deck: DEFAULT_DECK,
  handSize: 4,
  initialPeekSlots: [2, 3],
  initialDiscard: false,
  callerFailPenalty: 15,
  othersPenaltyWhenCallerWins: 10,
  lockCallerHand: 'multiplayerOnly',
  giveAfterOpponentMatch: 'optional',
  reshuffleDiscardWhenDeckEmpty: true,
  addOnDoubleFourteen: false,
  addOnFourteenTwentyFive: false,
  maxRounds: null,
  scoreLimit: null,
};

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

export function resolveRules(overrides: Partial<RulesConfig> = {}): RulesConfig {
  const rules: RulesConfig = { ...DEFAULT_RULES, ...overrides };
  if (!Number.isInteger(rules.handSize) || rules.handSize < 1) throw new Error('handSize must be a positive integer');
  for (const s of rules.initialPeekSlots) {
    if (!Number.isInteger(s) || s < 0 || s >= rules.handSize) throw new Error(`initialPeekSlots contains invalid slot ${s}`);
  }
  for (const e of rules.deck) {
    if (!Number.isInteger(e.value) || !Number.isInteger(e.count) || e.count < 0) throw new Error('invalid deck entry');
  }
  return rules;
}
