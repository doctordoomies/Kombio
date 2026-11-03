import type { SlotRef } from '../engine/actions';
import type { SlotView } from '../engine/view';
import type { HighlightKind } from './controller';

export interface CardRenderOptions {
  ref: SlotRef;
  owner: string;
  slot: SlotView;
  faceUp: boolean;
  small: boolean;
  target: boolean;
  dim: boolean;
  selected: boolean;
  viewed: boolean;
  locked: boolean;
  highlight: HighlightKind | null;
  onClick: (ref: SlotRef) => void;
}

/** Renders one hand slot as a button. Values are only ever read from the player's own view. */
export function renderCard(o: CardRenderOptions): HTMLButtonElement {
  const b = document.createElement('button');
  b.dataset.player = String(o.ref.player);
  b.dataset.slot = String(o.ref.slot);
  if (!o.slot.occupied) {
    b.className = `card empty${o.small ? ' sm' : ''}`;
    b.disabled = true;
    b.setAttribute('aria-label', `${o.owner}: empty slot`);
    return b;
  }
  const showValue = o.faceUp && o.slot.value !== null;
  const classes = ['card'];
  if (o.small) classes.push('sm');
  if (!showValue) classes.push('back');
  if (o.slot.value !== null) classes.push('known');
  if (o.target) classes.push('target');
  if (o.dim) classes.push('dim');
  if (o.selected) classes.push('selected');
  if (o.viewed) classes.push('viewed');
  if (o.locked) classes.push('locked');
  if (o.highlight) classes.push('hl', `hl-${o.highlight}`);
  b.className = classes.join(' ');
  b.textContent = showValue ? String(o.slot.value) : '✦';
  const status = o.slot.value !== null && !showValue ? ', seen' : '';
  b.setAttribute('aria-label', `${o.owner}: card ${o.ref.slot + 1}${showValue ? `, ${o.slot.value}` : status}`);
  b.onclick = () => o.onClick(o.ref);
  return b;
}
