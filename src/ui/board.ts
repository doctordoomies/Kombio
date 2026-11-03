import { ABILITY_LABELS } from '../engine/cards';
import type { Action, SlotRef } from '../engine/actions';
import type { PlayerView } from '../engine/view';
import { renderCard } from './cards';
import { HUMAN, type GameController } from './controller';
import { DIFFICULTY_INFO } from './settings';
import { renderRoundSummary, renderScoreboard } from './summary';
import { sameRef, targetingFor, type InteractionState } from './targeting';

export interface UiState extends InteractionState {
  error: string;
  /** Round number whose summary the human dismissed (to view the revealed table). */
  summaryDismissed: number | null;
}

export interface BoardContext {
  game: GameController;
  ui: UiState;
  rerender: () => void;
  newGame: () => void;
}

const $ = (id: string) => document.getElementById(id)!;
const has = (list: SlotRef[], r: SlotRef) => list.some((x) => sameRef(x, r));

/** Seat positions for opponents, clockwise from the human (who sits at the bottom). */
export function seatPositions(players: number): ('left' | 'top' | 'right')[] {
  if (players === 2) return ['top'];
  if (players === 3) return ['left', 'right'];
  return ['left', 'top', 'right'];
}

/** Sends an action to the engine and shows the engine's message if it is rejected. */
export function send(ctx: BoardContext, action: Action): void {
  const result = ctx.game.dispatch(action);
  if (!result.ok) {
    ctx.ui.error = result.error;
    ctx.rerender();
  } else {
    ctx.ui.error = '';
  }
}

export function onCardClick(ctx: BoardContext, ref: SlotRef): void {
  const view = ctx.game.view();
  const { ui } = ctx;
  const me = view.viewer;
  const targeting = targetingFor(view, ui);
  if (!targeting.active) {
    ui.error = view.phase === 'playing' && view.current !== me && !view.interrupt ? "It's not your turn. You can still match the discard (M)." : '';
    ctx.rerender();
    return;
  }
  if (!targeting.isTarget(ref)) {
    ui.error = targeting.invalidHint;
    ctx.rerender();
    return;
  }
  ui.error = '';
  if (ui.matchMode) {
    ui.matchMode = false;
    send(ctx, { type: 'match', player: me, target: ref });
    return;
  }
  if (view.interrupt?.kind === 'give') {
    send(ctx, { type: 'giveCard', player: me, slot: ref.slot });
    return;
  }
  if (view.step === 'holding') {
    send(ctx, { type: 'replace', player: me, slot: ref.slot });
    return;
  }
  const ab = view.ability!;
  if (ab.stage === 'choose' && (ab.ability === 'blindSwap' || ab.ability === 'doubleLookAndSwap')) {
    if (!ui.pick) ui.pick = ref;
    else if (sameRef(ui.pick, ref)) ui.pick = null;
    else {
      const a = ui.pick;
      ui.pick = null;
      send(ctx, ab.ability === 'blindSwap' ? { type: 'useSwap', player: me, a, b: ref } : { type: 'useDoublePeek', player: me, a, b: ref });
      return;
    }
    ctx.rerender();
    return;
  }
  if (ab.stage === 'choose') {
    send(ctx, { type: 'usePeek', player: me, target: ref });
    return;
  }
  if (ab.ability === 'lookAndSwap' && ab.viewed[0]) send(ctx, { type: 'useSwap', player: me, a: ab.viewed[0], b: ref });
}

export function toggleMatch(ctx: BoardContext): void {
  if (!ctx.game.view().can.match) return;
  ctx.ui.matchMode = !ctx.ui.matchMode;
  ctx.ui.pick = null;
  ctx.ui.error = '';
  ctx.rerender();
}

function valueAt(view: PlayerView, r: SlotRef | undefined): string {
  if (!r) return '?';
  return String(view.hands[r.player].slots[r.slot]?.value ?? '?');
}

function where(view: PlayerView, r: SlotRef): string {
  return r.player === view.viewer ? `your card ${r.slot + 1}` : `${view.players[r.player]}'s card ${r.slot + 1}`;
}

export function messageFor(view: PlayerView, ui: UiState): string {
  const me = view.viewer;
  const n = (p: number) => view.players[p];
  if (view.phase === 'memorize') return view.can.ready ? 'Memorize your bottom two cards, then click Ready.' : 'Waiting for the others to finish memorizing…';
  if (view.phase === 'ended') return view.gameOver ? 'Game over.' : 'Round over — see the summary.';
  if (ui.matchMode) return `Match mode: click a card from any hand that you think is a ${view.discardTop}. One attempt per discard; a wrong guess costs a penalty card.`;
  const it = view.interrupt;
  if (it?.kind === 'give') return it.giver === me ? `Match! You may give ${n(it.receiver)} one of your cards (you don't look at it), or keep them all.` : `${n(it.giver)} is deciding whether to give ${it.receiver === me ? 'you' : n(it.receiver)} a card…`;
  if (it?.kind === 'mismatch')
    return it.owner === me
      ? `${n(it.matcher)} wrongly tried your ${it.value} (it didn't match). Make them take that card, or return it and give them a penalty card?`
      : `Wrong match — that was a ${it.value}. ${n(it.owner)} is choosing the penalty…`;
  if (view.current !== me) return view.can.match ? `${n(view.current)} is playing. You can still match the ${view.discardTop} (M).` : `${n(view.current)} is playing…`;
  if (view.step === 'start') {
    const parts = ['draw from the deck'];
    if (view.can.takeDiscard) parts.push(`take the ${view.discardTop}`);
    if (view.can.callKombio) parts.push('call KOMBIO');
    return `Your turn${view.caller !== null ? ' (final turn)' : ''}: ${parts.join(', ')}.`;
  }
  if (view.step === 'holding') {
    const v = view.held!.value!;
    if (view.held!.source === 'discard') return `You took the ${v}. Click one of your cards to exchange it.`;
    return `You drew a ${v}. Click one of your cards to exchange it, or discard it${v >= 7 ? ` to use ${ABILITY_LABELS[abilityName(v)]}` : ''}.`;
  }
  const ab = view.ability!;
  const label = ABILITY_LABELS[ab.ability];
  if (ab.stage === 'choose') {
    switch (ab.ability) {
      case 'peekOwn':
        return `${label}: click one of your cards to look at it.`;
      case 'peekOpponent':
        return `${label}: click any opponent's card to look at it.`;
      case 'blindSwap':
        return ui.pick ? `${label}: ${where(view, ui.pick)} selected — click the card to swap it with.` : `${label}: click the first of two cards to swap (any hands, including two opponents').`;
      case 'lookAndSwap':
        return `${label}: click any card to look at it.`;
      case 'doubleLookAndSwap':
        return ui.pick ? `${label}: ${where(view, ui.pick)} selected — click the second card to look at.` : `${label}: click the first of two cards to look at.`;
    }
  }
  return ab.ability === 'lookAndSwap'
    ? `${where(view, ab.viewed[0])} is a ${valueAt(view, ab.viewed[0])}. Click another card to exchange it with (unseen), or keep the cards.`
    : `${where(view, ab.viewed[0])} is a ${valueAt(view, ab.viewed[0])}; ${where(view, ab.viewed[1])} is a ${valueAt(view, ab.viewed[1])}. Swap them?`;
}

function abilityName(v: number): keyof typeof ABILITY_LABELS {
  return v <= 8 ? 'peekOwn' : v <= 10 ? 'peekOpponent' : v <= 12 ? 'blindSwap' : v === 13 ? 'lookAndSwap' : 'doubleLookAndSwap';
}

function button(container: HTMLElement, label: string, onClick: () => void, cls = '', title = ''): void {
  const b = document.createElement('button');
  b.className = `action ${cls}`;
  b.textContent = label;
  if (title) b.title = title;
  b.onclick = onClick;
  container.append(b);
}

function seatHead(view: PlayerView, player: number, ctx: BoardContext): HTMLElement[] {
  const h = view.hands[player];
  const out: HTMLElement[] = [];
  const span = (text: string, cls: string) => {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    out.push(s);
  };
  span(h.name, 'seat-name');
  const profile = ctx.game.profiles[player];
  if (profile) span(DIFFICULTY_INFO[profile.difficulty].label, 'badge');
  if (view.dealer === player) span('Dealer', 'badge dealer');
  if (view.phase === 'playing' && view.current === player) span(player === view.viewer ? 'YOUR TURN' : 'TURN', 'badge turn');
  if (view.caller === player) span('KOMBIO', 'badge kombio');
  if (h.locked) span('Locked', 'badge locked');
  if (view.phase === 'memorize') span(view.ready[player] ? 'Ready' : 'Memorizing', 'badge');
  const meta = document.createElement('div');
  meta.className = 'seat-meta';
  meta.style.flexBasis = '100%';
  meta.textContent = `${view.scores[player]} pts · ${h.cardCount} card${h.cardCount === 1 ? '' : 's'}`;
  out.push(meta);
  return out;
}

function handCards(view: PlayerView, player: number, ctx: BoardContext): HTMLElement[] {
  const { ui, game } = ctx;
  const me = view.viewer;
  const targeting = targetingFor(view, ui);
  const viewedByMe = view.ability && view.current === me ? view.ability.viewed : [];
  const revealed: SlotRef[] = view.interrupt?.kind === 'mismatch' ? [{ player: view.interrupt.owner, slot: view.interrupt.slot }] : [];
  return view.hands[player].slots.map((slot) => {
    const ref = { player, slot: slot.slot };
    const faceUp =
      view.phase === 'ended' || (view.phase === 'memorize' && player === me) || has(game.flash, ref) || has(viewedByMe, ref) || has(revealed, ref);
    const target = targeting.active && targeting.isTarget(ref);
    return renderCard({
      ref,
      owner: view.players[player],
      slot,
      faceUp,
      small: player !== me,
      target,
      dim: targeting.active && !target && slot.occupied,
      selected: sameRef(ui.pick, ref),
      viewed: has(viewedByMe, ref),
      locked: view.hands[player].locked,
      highlight: game.highlights.find((h) => sameRef(h.ref, ref))?.kind ?? null,
      onClick: (r) => onCardClick(ctx, r),
    });
  });
}

function renderActions(view: PlayerView, ctx: BoardContext): void {
  const box = $('actions');
  box.replaceChildren();
  const me = view.viewer;
  const d = (a: Action) => send(ctx, a);
  const it = view.interrupt;
  if (view.phase === 'memorize' && view.can.ready) button(box, 'Ready — hide my cards', () => d({ type: 'ready', player: me }), 'primary');
  if (view.phase === 'ended') {
    if (view.gameOver) button(box, 'New game', ctx.newGame, 'primary');
    else button(box, 'Next round', () => d({ type: 'nextRound', player: me }), 'primary');
    button(box, 'Show summary', () => {
      ctx.ui.summaryDismissed = null;
      ctx.rerender();
    });
    return;
  }
  if (it?.kind === 'give' && it.giver === me) button(box, 'Keep my cards', () => d({ type: 'declineGive', player: me }));
  if (it?.kind === 'mismatch' && it.owner === me) {
    button(box, `${view.players[it.matcher]} takes the ${it.value}`, () => d({ type: 'resolveMismatch', player: me, choice: 'matcherTakes' }), 'primary');
    button(box, 'Return it + penalty card', () => d({ type: 'resolveMismatch', player: me, choice: 'returnAndPenalty' }));
  }
  if (view.can.drawDeck) button(box, 'Draw from deck', () => d({ type: 'drawDeck', player: me }), 'primary', 'D');
  if (view.can.takeDiscard) button(box, `Take the ${view.discardTop}`, () => d({ type: 'takeDiscard', player: me }), '', 'T');
  if (view.can.callKombio) button(box, 'Call KOMBIO!', () => d({ type: 'callKombio', player: me }), 'gold');
  if (view.can.pass) button(box, 'Pass (no legal move)', () => d({ type: 'pass', player: me }));
  if (view.current === me && !it) {
    if (view.step === 'holding' && view.held?.source === 'deck') {
      const v = view.held.value!;
      button(box, v >= 7 ? `Discard ${v} & use ability` : `Discard ${v}`, () => d({ type: 'discardHeld', player: me }), 'primary');
    }
    if (view.step === 'ability' && view.ability) {
      const ab = view.ability;
      if (ab.ability === 'doubleLookAndSwap' && ab.stage === 'decide' && ab.viewed.length === 2)
        button(box, 'Swap the two cards', () => d({ type: 'useSwap', player: me, a: ab.viewed[0], b: ab.viewed[1] }), 'primary');
      if (ctx.ui.pick)
        button(box, 'Clear selection', () => {
          ctx.ui.pick = null;
          ctx.rerender();
        });
      button(
        box,
        ab.stage === 'decide' ? 'Keep cards' : 'Skip ability',
        () => {
          ctx.ui.pick = null;
          d({ type: 'skipAbility', player: me });
        },
        '',
        'S',
      );
    }
  }
  if (view.can.match) button(box, ctx.ui.matchMode ? 'Cancel match' : `Match the ${view.discardTop}`, () => toggleMatch(ctx), ctx.ui.matchMode ? 'active' : '', 'M');
}

function renderBanner(view: PlayerView): void {
  const b = $('turn-banner');
  const me = view.viewer;
  b.className = 'banner';
  if (view.phase === 'memorize') b.textContent = `Round ${view.roundNumber} · memorize your bottom two cards`;
  else if (view.phase === 'ended') b.textContent = view.gameOver ? 'Game over' : `Round ${view.roundNumber} complete`;
  else {
    const who = view.current === me ? 'Your turn' : `${view.players[view.current]}'s turn`;
    b.textContent = view.caller !== null ? `${who} · final turns (KOMBIO: ${view.players[view.caller]})` : who;
    if (view.current === me) b.classList.add('mine');
    if (view.caller !== null) b.classList.add('final');
  }
}

function renderPiles(view: PlayerView, ctx: BoardContext): void {
  const deck = $('deck') as HTMLButtonElement;
  const discard = $('discard') as HTMLButtonElement;
  $('deckcount').textContent = `Deck · ${view.deckCount}`;
  discard.textContent = view.discardTop === null ? '—' : String(view.discardTop);
  discard.className = view.discardTop === null ? 'card empty' : 'card';
  $('discardlabel').textContent = `Discard · ${view.discardCount}`;
  deck.classList.toggle('target', view.can.drawDeck);
  discard.classList.toggle('target', view.can.takeDiscard || ctx.ui.matchMode);
  const held = view.held;
  ($('heldbox') as HTMLElement).hidden = !held;
  if (held) {
    const hb = $('held');
    hb.textContent = held.value === null ? '✦' : String(held.value);
    hb.className = held.value === null ? 'card back' : 'card';
    $('heldlabel').textContent = held.holder === view.viewer ? 'Your drawn card' : `${view.players[held.holder]}'s card`;
  }
}

function renderSummary(view: PlayerView, ctx: BoardContext): void {
  const overlay = $('summary') as HTMLElement;
  const show = view.phase === 'ended' && ctx.ui.summaryDismissed !== view.roundNumber;
  overlay.hidden = !show;
  if (!show) return;
  const { caller, body } = renderRoundSummary(view);
  $('summary-title').textContent = view.gameOver ? 'Final results' : `Round ${view.roundNumber} summary`;
  $('summary-caller').textContent = caller;
  $('summary-body').replaceChildren(body);
  const actions = $('summary-actions');
  actions.replaceChildren();
  if (view.gameOver) button(actions, 'New game', ctx.newGame, 'primary');
  else button(actions, 'Next round', () => send(ctx, { type: 'nextRound', player: view.viewer }), 'primary');
  button(actions, 'View table', () => {
    ctx.ui.summaryDismissed = view.roundNumber;
    ctx.rerender();
  });
}

export function renderGame(ctx: BoardContext): void {
  const view = ctx.game.view(HUMAN);
  const me = view.viewer;
  if (view.phase !== 'playing') {
    ctx.ui.matchMode = false;
    ctx.ui.pick = null;
  }
  if (ctx.ui.matchMode && !view.can.match) ctx.ui.matchMode = false;
  if (view.step !== 'ability') ctx.ui.pick = null;

  // Opponent seats around the table.
  const areas = { left: $('area-left'), top: $('area-top'), right: $('area-right') };
  for (const a of Object.values(areas)) a.replaceChildren();
  seatPositions(view.players.length).forEach((pos, i) => {
    const player = i + 1;
    const seat = document.createElement('section');
    seat.className = `seat seat-${pos}${view.phase === 'playing' && view.current === player ? ' active' : ''}`;
    seat.id = `seat-${player}`;
    const head = document.createElement('div');
    head.className = 'seat-head';
    head.append(...seatHead(view, player, ctx));
    const cards = document.createElement('div');
    cards.className = 'cards';
    cards.append(...handCards(view, player, ctx));
    seat.append(head, cards);
    areas[pos].append(seat);
  });

  // Human seat.
  $('seat-0').className = `seat seat-human${view.phase === 'playing' && view.current === me ? ' active' : ''}`;
  $('seat-0-head').replaceChildren(...seatHead(view, me, ctx));
  $('hand').replaceChildren(...handCards(view, me, ctx));
  $('message').textContent = messageFor(view, ctx.ui);
  $('error').textContent = ctx.ui.error;

  renderBanner(view);
  renderPiles(view, ctx);
  renderActions(view, ctx);
  $('scoreboard').replaceChildren(renderScoreboard(view, ctx.game.settings));
  $('log').replaceChildren(
    ...ctx.game.log.map((entry) => {
      const d = document.createElement('div');
      d.textContent = `• ${entry.text}`;
      if (entry.player === me) d.className = 'me';
      return d;
    }),
  );
  renderSummary(view, ctx);
}
