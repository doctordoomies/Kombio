import type { SlotRef } from '../engine/actions';
import type { PlayerView } from '../engine/view';

/** Presentation-only interaction state (never sent to the engine). */
export interface InteractionState {
  matchMode: boolean;
  /** First card picked for two-card abilities (11/12 swap, 14 look). */
  pick: SlotRef | null;
}

export interface Targeting {
  /** True when the human is expected to click a card. */
  active: boolean;
  /** Whether a click on this card is a sensible choice right now. */
  isTarget: (ref: SlotRef) => boolean;
  /** Feedback shown when the human clicks a card that isn't a target. */
  invalidHint: string;
}

export const sameRef = (a: SlotRef | null | undefined, b: SlotRef) => !!a && a.player === b.player && a.slot === b.slot;

const NONE: Targeting = { active: false, isTarget: () => false, invalidHint: '' };

/**
 * Which cards the human may click right now. Purely advisory: it makes valid
 * targets obvious and gives friendly feedback, while the engine remains the
 * authority on legality.
 */
export function targetingFor(view: PlayerView, ui: InteractionState): Targeting {
  const me = view.viewer;
  if (view.phase !== 'playing') return NONE;
  const occupied = (r: SlotRef) => view.hands[r.player]?.slots[r.slot]?.occupied === true;
  const unlocked = (r: SlotRef) => !view.hands[r.player]?.locked;
  const any = (r: SlotRef) => occupied(r) && unlocked(r);
  const own = (r: SlotRef) => r.player === me && occupied(r);

  if (ui.matchMode) {
    return { active: true, isTarget: any, invalidHint: "That card can't be used to match (empty slot or a locked KOMBIO hand)." };
  }
  const it = view.interrupt;
  if (it?.kind === 'give' && it.giver === me) return { active: true, isTarget: own, invalidHint: 'Choose one of your own cards to give.' };
  if (it || view.current !== me) return NONE;

  if (view.step === 'holding') return { active: true, isTarget: own, invalidHint: 'Click one of your own cards to exchange the drawn card with it.' };
  const ab = view.ability;
  if (view.step !== 'ability' || !ab) return NONE;

  if (ab.stage === 'choose') {
    switch (ab.ability) {
      case 'peekOwn':
        return { active: true, isTarget: (r) => own(r) && unlocked(r), invalidHint: 'A 7 or 8 lets you look at one of your own cards.' };
      case 'peekOpponent':
        return { active: true, isTarget: (r) => r.player !== me && any(r), invalidHint: "A 9 or 10 lets you look at one of an opponent's cards." };
      default:
        return { active: true, isTarget: any, invalidHint: 'Choose a card on the table (not an empty slot or a locked KOMBIO hand).' };
    }
  }
  if (ab.ability === 'lookAndSwap') {
    return {
      active: true,
      isTarget: (r) => any(r) && !ab.viewed.some((v) => sameRef(v, r)),
      invalidHint: 'Choose a different card to exchange with the one you looked at, or keep the cards.',
    };
  }
  return NONE; // 14 decide: answered with buttons
}
