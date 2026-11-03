import type { SlotRef } from '../engine/actions';
import type { SlotView } from '../engine/view';

export interface CardRenderOptions {
  ref: SlotRef;
  slot: SlotView;
  faceUp: boolean;
  selected: boolean;
  viewed: boolean;
  locked: boolean;
  onClick: (ref: SlotRef) => void;
}

/** Renders one hand slot as a button. Values are only ever read from the player's view. */
export function renderCard(o: CardRenderOptions): HTMLButtonElement {
  const b = document.createElement('button');
  if (!o.slot.occupied) {
    b.className = 'card empty';
    b.disabled = true;
    b.setAttribute('aria-label', 'Empty slot');
    return b;
  }
  const showValue = o.faceUp && o.slot.value !== null;
  const classes = ['card'];
  if (!showValue) classes.push('back');
  if (o.slot.value !== null) classes.push('known');
  if (o.selected) classes.push('selected');
  if (o.viewed) classes.push('viewed');
  if (o.locked) classes.push('locked');
  b.className = classes.join(' ');
  b.textContent = showValue ? String(o.slot.value) : '✦';
  b.setAttribute('aria-label', `Card ${o.ref.slot + 1}${showValue ? `: ${o.slot.value}` : ''}`);
  b.onclick = () => o.onClick(o.ref);
  return b;
}
