import type { Action, SlotRef } from '../engine/actions';
import type { PlayerView, SlotView } from '../engine/view';

/**
 * A simple computer opponent.
 *
 * It receives only a PlayerView — the same redacted view a human client gets —
 * so it cannot inspect hidden cards or the deck order. It has perfect memory of
 * what it has legitimately seen (the view reports every value it knows).
 */
export interface OpponentOptions {
  /** Call KOMBIO when the estimated hand total is at most this. */
  callThreshold: number;
  /** Maximum number of unknown cards in hand when calling KOMBIO. */
  maxUnknownToCall: number;
}

export const DEFAULT_OPPONENT: OpponentOptions = { callThreshold: 7, maxUnknownToCall: 1 };

interface Slot extends SlotView {
  player: number;
}

/** Average card value of the configured deck: the estimate used for unseen cards. */
export function expectedUnknownValue(view: PlayerView): number {
  let sum = 0;
  let count = 0;
  for (const e of view.rules.deck) {
    sum += e.value * e.count;
    count += e.count;
  }
  return count ? sum / count : 0;
}

function slotsOf(view: PlayerView, player: number): Slot[] {
  return view.hands[player].slots.filter((s) => s.occupied).map((s) => ({ ...s, player }));
}

function opponentSlots(view: PlayerView): Slot[] {
  return view.hands
    .filter((h) => h.player !== view.viewer && !h.locked)
    .flatMap((h) => slotsOf(view, h.player));
}

function ref(s: Slot): SlotRef {
  return { player: s.player, slot: s.slot };
}

function estimate(s: Slot, exp: number): number {
  return s.value ?? exp;
}

function highest(slots: Slot[], exp: number): Slot | undefined {
  return slots.slice().sort((a, b) => estimate(b, exp) - estimate(a, exp))[0];
}

function lowestKnown(slots: Slot[]): Slot | undefined {
  return slots.filter((s) => s.value !== null).sort((a, b) => a.value! - b.value!)[0];
}

function estimatedTotal(view: PlayerView, player: number, exp: number): number {
  return slotsOf(view, player).reduce((sum, s) => sum + estimate(s, exp), 0);
}

/**
 * Returns the action this player must or wants to take now (memorization,
 * pending decisions owed by this player, or its own turn), or null if it has
 * nothing to do. Opportunistic matching is handled separately by decideMatch.
 */
export function decideAction(view: PlayerView, options: OpponentOptions = DEFAULT_OPPONENT): Action | null {
  const me = view.viewer;
  const exp = expectedUnknownValue(view);
  if (view.gameOver) return null;
  if (view.phase === 'memorize') return view.can.ready ? { type: 'ready', player: me } : null;
  if (view.phase !== 'playing') return null;

  const it = view.interrupt;
  if (it) {
    if (it.kind === 'give' && it.giver === me) {
      const worst = highest(slotsOf(view, me), exp);
      if (worst && estimate(worst, exp) > 0) return { type: 'giveCard', player: me, slot: worst.slot };
      if (view.rules.giveAfterOpponentMatch === 'required' && worst) return { type: 'giveCard', player: me, slot: worst.slot };
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
    if (view.can.callKombio && unknownMine.length <= options.maxUnknownToCall) {
      const myTotal = estimatedTotal(view, me, exp);
      const others = view.hands.filter((h) => h.player !== me).map((h) => estimatedTotal(view, h.player, exp));
      if (myTotal <= options.callThreshold && others.every((t) => t > myTotal)) return { type: 'callKombio', player: me };
    }
    const top = view.discardTop;
    if (view.can.takeDiscard && top !== null) {
      const improvesKnown = worstKnown !== undefined && top < worstKnown.value! - 1;
      const improvesUnknown = unknownMine.length > 0 && top <= 2;
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
    if (worstKnown && v < worstKnown.value!) return { type: 'replace', player: me, slot: worstKnown.slot };
    if (unknownMine.length && v <= 4) return { type: 'replace', player: me, slot: unknownMine[0].slot };
    if (view.held.source === 'discard') {
      const target = highest(mine, exp)!;
      return { type: 'replace', player: me, slot: target.slot };
    }
    return { type: 'discardHeld', player: me };
  }

  if (view.step === 'ability' && view.ability) {
    return decideAbility(view, mine, exp) ?? { type: 'skipAbility', player: me };
  }
  return null;
}

function decideAbility(view: PlayerView, mine: Slot[], exp: number): Action | null {
  const me = view.viewer;
  const { ability, stage, viewed } = view.ability!;
  const opp = opponentSlots(view);
  const unknownMine = mine.filter((s) => s.value === null);
  const unknownOpp = opp.filter((s) => s.value === null);
  const worstMine = highest(mine, exp);
  const lowOpp = lowestKnown(opp);

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
      const value = view.hands[v.player].slots[v.slot].value!;
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
      const xv = view.hands[x.player].slots[x.slot].value!;
      const yv = view.hands[y.player].slots[y.slot].value!;
      const [mineRef, mineVal, theirVal] = x.player === me ? [x, xv, yv] : y.player === me ? [y, yv, xv] : [null, 0, 0];
      return mineRef && mineVal > theirVal ? { type: 'useSwap', player: me, a: x, b: y } : null;
    }
  }
}

/**
 * Opportunistic matching: returns a match the player is certain about (it only
 * matches cards whose value it legitimately knows), preferring its own cards.
 */
export function decideMatch(view: PlayerView): Action | null {
  if (!view.can.match || view.discardTop === null) return null;
  const me = view.viewer;
  const top = view.discardTop;
  const own = slotsOf(view, me).find((s) => s.value === top);
  if (own && !view.hands[me].locked) return { type: 'match', player: me, target: ref(own) };
  if (slotsOf(view, me).length === 0) return null;
  const theirs = opponentSlots(view).find((s) => s.value === top);
  return theirs ? { type: 'match', player: me, target: ref(theirs) } : null;
}
