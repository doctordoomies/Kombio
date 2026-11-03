import type { Action, SlotRef } from '../engine/actions';
import type { PlayerView, SlotView } from '../engine/view';
import { seededRng, type Rng } from '../engine/rng';

/**
 * Computer opponents.
 *
 * Every decision function receives only a PlayerView — the same redacted view
 * a human client gets — so no difficulty level can inspect hidden cards or the
 * deck order. Difficulty only changes how well the AI uses that information.
 * All decisions are ordinary Actions, validated by the engine like a human's.
 */
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface Profile {
  difficulty: Difficulty;
  /** Call KOMBIO when the estimated hand total is at most this… */
  callThreshold: number;
  /** …with at most this many unknown cards in hand… */
  maxUnknownToCall: number;
  /** …and every opponent's estimate exceeds ours by more than this. */
  callMargin: number;
  /** Chance per decision to "forget" each remembered card (imperfect memory). */
  forgetChance: number;
  /** Chance of a careless exchange/discard or a skipped ability. */
  blunderChance: number;
  /** Chance to guess a match with an own card it does not actually know (usually a penalty). */
  wrongMatchChance: number;
  /** Chance to not notice a match it could make. */
  missMatchChance: number;
  /** Whether it matches opponents' known cards (and then gives a card away). */
  matchOpponents: boolean;
  /** Estimate unknown cards from the cards it has not seen, instead of the deck average. */
  smartEstimate: boolean;
  /** Aim peeks, swaps and gifts at the opponent with the lowest estimated hand. */
  targetLeader: boolean;
  /** Put a drawn card on an unknown slot if its value is at most this. */
  replaceUnknownMax: number;
  /** Take the discard for an unknown slot if its value is at most this. */
  takeDiscardMax: number;
  /** UI pacing: how long this opponent takes to spot a match / play a turn. */
  matchDelayMs: number;
  turnDelayMs: number;
}

export const PROFILES: Record<Difficulty, Profile> = {
  easy: {
    difficulty: 'easy',
    // Tuned by simulation: wins roughly 1 in 5 two-player games against Normal.
    callThreshold: 8,
    maxUnknownToCall: 1,
    callMargin: 0,
    forgetChance: 0.15,
    blunderChance: 0.06,
    wrongMatchChance: 0.01,
    missMatchChance: 0.3,
    matchOpponents: false,
    smartEstimate: false,
    targetLeader: false,
    replaceUnknownMax: 4,
    takeDiscardMax: 2,
    matchDelayMs: 2600,
    turnDelayMs: 900,
  },
  normal: {
    difficulty: 'normal',
    callThreshold: 7,
    maxUnknownToCall: 1,
    callMargin: 0,
    forgetChance: 0,
    blunderChance: 0,
    wrongMatchChance: 0,
    missMatchChance: 0,
    matchOpponents: true,
    smartEstimate: false,
    targetLeader: false,
    replaceUnknownMax: 4,
    takeDiscardMax: 2,
    matchDelayMs: 1300,
    turnDelayMs: 750,
  },
  hard: {
    difficulty: 'hard',
    // Tuned by simulation: patient calling wins ~65% of decided 2-player games against Normal.
    callThreshold: 2,
    maxUnknownToCall: 1,
    callMargin: 1,
    forgetChance: 0,
    blunderChance: 0,
    wrongMatchChance: 0,
    missMatchChance: 0,
    matchOpponents: true,
    smartEstimate: true,
    targetLeader: true,
    replaceUnknownMax: 6,
    takeDiscardMax: 2,
    matchDelayMs: 800,
    turnDelayMs: 650,
  },
};

/** Backwards-compatible name for the Normal profile. */
export const DEFAULT_OPPONENT = PROFILES.normal;

interface Slot extends SlotView {
  player: number;
}

// ---------------------------------------------------------------------------
// Randomness: deterministic per game situation, so repeated calls in the same
// situation give the same answer (the UI re-asks after every state change).
// ---------------------------------------------------------------------------

function situationRng(view: PlayerView, seed: number, salt: number): Rng {
  const parts = [
    seed,
    salt,
    view.viewer,
    view.roundNumber,
    view.discardCount,
    view.deckCount,
    view.current,
    view.step.length,
    view.ability?.stage.length ?? 0,
    ...view.hands.map((h) => h.cardCount),
  ];
  let h = 2166136261;
  for (const p of parts) h = Math.imul(h ^ (p | 0), 16777619);
  return seededRng(h);
}

/** Easy opponents forget some of what they saw. Never hides values needed to finish an in-progress ability. */
function perceive(view: PlayerView, profile: Profile, seed: number): PlayerView {
  if (profile.forgetChance <= 0) return view;
  const rng = situationRng(view, seed, 1);
  const keep = view.ability?.viewed ?? [];
  return {
    ...view,
    hands: view.hands.map((h) => ({
      ...h,
      slots: h.slots.map((s) => {
        const pinned = keep.some((r) => r.player === h.player && r.slot === s.slot);
        return s.value !== null && !pinned && view.phase !== 'ended' && rng() < profile.forgetChance ? { ...s, value: null } : s;
      }),
    })),
  };
}

// ---------------------------------------------------------------------------
// Estimates
// ---------------------------------------------------------------------------

/** Average card value of the configured deck: the basic estimate for an unseen card. */
export function expectedUnknownValue(view: PlayerView): number {
  let sum = 0;
  let count = 0;
  for (const e of view.rules.deck) {
    sum += e.value * e.count;
    count += e.count;
  }
  return count ? sum / count : 0;
}

/**
 * Average value of the cards this player has NOT seen: the deck composition minus
 * every value visible to it (known hand cards, the top discard, a visible held card).
 */
export function unseenAverage(view: PlayerView): number {
  const remaining = new Map<number, number>();
  for (const e of view.rules.deck) remaining.set(e.value, e.count);
  const seen: number[] = [];
  for (const h of view.hands) for (const s of h.slots) if (s.value !== null) seen.push(s.value);
  if (view.discardTop !== null) seen.push(view.discardTop);
  if (view.held?.value != null) seen.push(view.held.value);
  for (const v of seen) remaining.set(v, Math.max(0, (remaining.get(v) ?? 0) - 1));
  let sum = 0;
  let count = 0;
  for (const [v, c] of remaining) {
    sum += v * c;
    count += c;
  }
  return count ? sum / count : expectedUnknownValue(view);
}

function slotsOf(view: PlayerView, player: number): Slot[] {
  return view.hands[player].slots.filter((s) => s.occupied).map((s) => ({ ...s, player }));
}

function opponentSlots(view: PlayerView): Slot[] {
  return view.hands.filter((h) => h.player !== view.viewer && !h.locked).flatMap((h) => slotsOf(view, h.player));
}

const ref = (s: Slot): SlotRef => ({ player: s.player, slot: s.slot });
const estimate = (s: Slot, exp: number) => s.value ?? exp;
const highest = (slots: Slot[], exp: number) => slots.slice().sort((a, b) => estimate(b, exp) - estimate(a, exp))[0] as Slot | undefined;
const lowestKnown = (slots: Slot[]) => slots.filter((s) => s.value !== null).sort((a, b) => a.value! - b.value!)[0] as Slot | undefined;

function estimatedTotal(view: PlayerView, player: number, exp: number): number {
  return slotsOf(view, player).reduce((sum, s) => sum + estimate(s, exp), 0);
}

/** Opponents ordered by priority: the leader (lowest estimated hand) first when targeting the leader. */
function opponentOrder(view: PlayerView, profile: Profile, exp: number): number[] {
  const opps = view.hands.filter((h) => h.player !== view.viewer && !h.locked && h.cardCount > 0).map((h) => h.player);
  if (profile.targetLeader) opps.sort((a, b) => estimatedTotal(view, a, exp) - estimatedTotal(view, b, exp));
  return opps;
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

/**
 * Returns the action this player must or wants to take now (memorization,
 * pending decisions owed by this player, or its own turn), or null if it has
 * nothing to do. Opportunistic matching is handled separately by decideMatch.
 */
export function decideAction(input: PlayerView, profile: Profile = PROFILES.normal, seed = 0): Action | null {
  const me = input.viewer;
  if (input.gameOver) return null;
  if (input.phase === 'memorize') return input.can.ready ? { type: 'ready', player: me } : null;
  if (input.phase !== 'playing') return null;

  const view = perceive(input, profile, seed);
  const exp = profile.smartEstimate ? unseenAverage(view) : expectedUnknownValue(view);
  const rng = situationRng(view, seed, 2);

  const it = view.interrupt;
  if (it) {
    if (it.kind === 'give' && it.giver === me) {
      const worst = highest(slotsOf(view, me), exp);
      if (worst && (estimate(worst, exp) > 0 || view.rules.giveAfterOpponentMatch === 'required')) {
        return { type: 'giveCard', player: me, slot: worst.slot };
      }
      return { type: 'declineGive', player: me };
    }
    if (it.kind === 'mismatch' && it.owner === me) {
      // Losing a positive card lowers our score; a non-positive card is worth keeping.
      return { type: 'resolveMismatch', player: me, choice: it.value > 0 ? 'matcherTakes' : 'returnAndPenalty' };
    }
    return null;
  }
  if (view.current !== me) return null;

  const mine = slotsOf(view, me);
  const unknownMine = mine.filter((s) => s.value === null);
  const worstKnown = highest(mine.filter((s) => s.value !== null), exp);

  if (view.step === 'start') {
    if (view.can.callKombio && unknownMine.length <= profile.maxUnknownToCall) {
      const myTotal = estimatedTotal(view, me, exp);
      const others = view.hands.filter((h) => h.player !== me).map((h) => estimatedTotal(view, h.player, exp));
      if (myTotal <= profile.callThreshold && others.every((t) => t > myTotal + profile.callMargin)) return { type: 'callKombio', player: me };
    }
    const top = view.discardTop;
    if (view.can.takeDiscard && top !== null) {
      const improvesKnown = worstKnown !== undefined && top < worstKnown.value! - 1;
      const improvesUnknown = unknownMine.length > 0 && top <= profile.takeDiscardMax;
      if (improvesKnown || improvesUnknown) return { type: 'takeDiscard', player: me };
    }
    if (view.can.drawDeck) return { type: 'drawDeck', player: me };
    if (view.can.takeDiscard) return { type: 'takeDiscard', player: me };
    if (view.can.callKombio) return { type: 'callKombio', player: me };
    if (view.can.pass) return { type: 'pass', player: me };
    return null;
  }

  if (view.step === 'holding' && view.held) {
    const v = view.held.value!;
    if (rng() < profile.blunderChance && mine.length) {
      // Careless play: exchange a random card, or throw the drawn card away.
      if (view.held.source === 'discard' || rng() < 0.5) return { type: 'replace', player: me, slot: mine[Math.floor(rng() * mine.length)].slot };
      return { type: 'discardHeld', player: me };
    }
    if (worstKnown && v < worstKnown.value!) return { type: 'replace', player: me, slot: worstKnown.slot };
    if (unknownMine.length && v <= profile.replaceUnknownMax) return { type: 'replace', player: me, slot: unknownMine[0].slot };
    if (view.held.source === 'discard' || mine.length === 0) {
      if (view.held.source === 'deck') return { type: 'discardHeld', player: me };
      return { type: 'replace', player: me, slot: highest(mine, exp)!.slot };
    }
    return { type: 'discardHeld', player: me };
  }

  if (view.step === 'ability' && view.ability) {
    if (view.ability.stage === 'choose' && rng() < profile.blunderChance) return { type: 'skipAbility', player: me };
    return decideAbility(view, profile, mine, exp) ?? { type: 'skipAbility', player: me };
  }
  return null;
}

function decideAbility(view: PlayerView, profile: Profile, mine: Slot[], exp: number): Action | null {
  const me = view.viewer;
  const { ability, stage, viewed } = view.ability!;
  const order = opponentOrder(view, profile, exp);
  const opp = order.flatMap((p) => slotsOf(view, p));
  const unknownMine = mine.filter((s) => s.value === null);
  const unknownOpp = opp.filter((s) => s.value === null);
  const worstMine = highest(mine, exp);
  // With targetLeader, prefer stealing a low card from the leader; otherwise the lowest known anywhere.
  const lowOpp = profile.targetLeader ? (order.map((p) => lowestKnown(slotsOf(view, p))).find(Boolean) ?? undefined) : lowestKnown(opp);

  // The best opponent card to receive in exchange for a card of `value`.
  const swapPartner = (value: number): Slot | undefined => {
    if (lowOpp && lowOpp.value! < value) return lowOpp;
    if (value > exp + 1) return unknownOpp[0];
    return undefined;
  };

  switch (ability) {
    case 'peekOwn':
      return unknownMine[0] ? { type: 'usePeek', player: me, target: ref(unknownMine[0]) } : null;
    case 'peekOpponent':
      return unknownOpp[0] ? { type: 'usePeek', player: me, target: ref(unknownOpp[0]) } : null;
    case 'blindSwap': {
      if (!worstMine || worstMine.value === null) return null;
      const partner = swapPartner(worstMine.value);
      return partner ? { type: 'useSwap', player: me, a: ref(worstMine), b: ref(partner) } : null;
    }
    case 'lookAndSwap': {
      if (stage === 'choose') {
        const target = unknownMine[0] ?? unknownOpp[0];
        return target ? { type: 'usePeek', player: me, target: ref(target) } : null;
      }
      const v = viewed[0];
      if (!v) return null;
      const value = view.hands[v.player].slots[v.slot].value;
      if (value === null) return null;
      if (v.player === me) {
        const partner = swapPartner(value);
        return partner ? { type: 'useSwap', player: me, a: v, b: ref(partner) } : null;
      }
      const others = mine.filter((s) => !(s.player === v.player && s.slot === v.slot));
      const give = highest(others, exp);
      return give && estimate(give, exp) > value + 1 ? { type: 'useSwap', player: me, a: v, b: ref(give) } : null;
    }
    case 'doubleLookAndSwap': {
      if (stage === 'choose') {
        const a = unknownMine[0] ?? worstMine;
        const b = unknownOpp[0] ?? lowOpp ?? opp[0];
        return a && b ? { type: 'useDoublePeek', player: me, a: ref(a), b: ref(b) } : null;
      }
      if (viewed.length < 2) return null;
      const [x, y] = viewed;
      const xv = view.hands[x.player].slots[x.slot].value;
      const yv = view.hands[y.player].slots[y.slot].value;
      if (xv === null || yv === null) return null;
      const [mineVal, theirVal] = x.player === me ? [xv, yv] : y.player === me ? [yv, xv] : [null, null];
      return mineVal !== null && theirVal !== null && mineVal > theirVal ? { type: 'useSwap', player: me, a: x, b: y } : null;
    }
  }
}

/**
 * Opportunistic matching. Normal and Hard only match cards whose value they
 * legitimately know, preferring their own. Easy sometimes misses a match or
 * guesses with a card it does not know (and usually takes a penalty).
 */
export function decideMatch(input: PlayerView, profile: Profile = PROFILES.normal, seed = 0): Action | null {
  if (!input.can.match || input.discardTop === null || input.phase !== 'playing') return null;
  const view = perceive(input, profile, seed);
  const rng = situationRng(view, seed, 3);
  const me = view.viewer;
  const top = view.discardTop!;
  const mine = view.hands[me].locked ? [] : slotsOf(view, me);
  const own = mine.find((s) => s.value === top);
  const missed = rng() < profile.missMatchChance;
  if (own && !missed) return { type: 'match', player: me, target: ref(own) };
  if (rng() < profile.wrongMatchChance) {
    const guess = mine.filter((s) => s.value === null);
    if (guess.length) return { type: 'match', player: me, target: ref(guess[Math.floor(rng() * guess.length)]) };
  }
  if (missed || !profile.matchOpponents || mine.length === 0) return null;
  const theirs = opponentSlots(view).find((s) => s.value === top);
  return theirs ? { type: 'match', player: me, target: ref(theirs) } : null;
}
