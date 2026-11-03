import { ABILITY_LABELS } from '../engine/cards';
import type { Action, SlotRef } from '../engine/actions';
import type { GameEvent } from '../engine/game';
import type { PlayerView } from '../engine/view';
import { renderCard } from './cards';

/** Presentation-only state (never sent to the engine). */
export interface UiState {
  matchMode: boolean;
  /** First card picked for two-card abilities (11/12 swap, 14 look). */
  pick: SlotRef | null;
  /** Cards temporarily shown face up to the human (after a peek or a public reveal). */
  flash: SlotRef[];
  error: string;
  log: string[];
}

export interface BoardHandlers {
  dispatch: (action: Action) => void;
  ui: UiState;
  rerender: () => void;
  newGame: () => void;
}

const $ = (id: string) => document.getElementById(id)!;
const same = (a: SlotRef | null, b: SlotRef) => !!a && a.player === b.player && a.slot === b.slot;
const has = (list: SlotRef[], r: SlotRef) => list.some((x) => same(x, r));

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

function button(label: string, onClick: () => void, cls = '', disabled = false): void {
  const b = document.createElement('button');
  b.className = `action ${cls}`;
  b.textContent = label;
  b.disabled = disabled;
  b.onclick = onClick;
  $('actions').append(b);
}

/** What happens when the human clicks a card, given the current view. */
function onCardClick(view: PlayerView, h: BoardHandlers, ref: SlotRef): void {
  const me = view.viewer;
  const { ui } = h;
  ui.error = '';
  if (ui.matchMode) {
    ui.matchMode = false;
    h.dispatch({ type: 'match', player: me, target: ref });
    return;
  }
  if (view.interrupt?.kind === 'give' && view.interrupt.giver === me) {
    if (ref.player === me) h.dispatch({ type: 'giveCard', player: me, slot: ref.slot });
    return;
  }
  if (view.current !== me || view.phase !== 'playing' || view.interrupt) return;
  if (view.step === 'holding') {
    if (ref.player === me) h.dispatch({ type: 'replace', player: me, slot: ref.slot });
    return;
  }
  const ab = view.ability;
  if (view.step !== 'ability' || !ab) return;
  if (ab.stage === 'choose') {
    if (ab.ability === 'blindSwap' || ab.ability === 'doubleLookAndSwap') {
      if (!ui.pick) ui.pick = ref;
      else if (same(ui.pick, ref)) ui.pick = null;
      else {
        const a = ui.pick;
        ui.pick = null;
        h.dispatch(ab.ability === 'blindSwap' ? { type: 'useSwap', player: me, a, b: ref } : { type: 'useDoublePeek', player: me, a, b: ref });
        return;
      }
      h.rerender();
      return;
    }
    h.dispatch({ type: 'usePeek', player: me, target: ref });
    return;
  }
  if (ab.ability === 'lookAndSwap' && ab.viewed[0]) h.dispatch({ type: 'useSwap', player: me, a: ab.viewed[0], b: ref });
}

function messageFor(view: PlayerView, ui: UiState): string {
  const me = view.viewer;
  const n = (p: number) => view.players[p];
  if (view.phase === 'memorize') return view.can.ready ? 'Memorize your bottom two cards, then click Ready.' : 'Waiting for the other player…';
  if (view.phase === 'ended') {
    const r = view.lastResult!;
    const who = r.caller === null ? '' : r.callerWon ? `${n(r.caller)} called KOMBIO and had the lowest hand. ` : `${n(r.caller)} called KOMBIO but was tied or beaten (+15). `;
    return `${who}Hands: ${r.handScores.map((s, i) => `${n(i)} ${s}`).join(', ')}. Round scores: ${r.roundScores.map((s, i) => `${n(i)} ${s}`).join(', ')}.`;
  }
  if (ui.matchMode) return `Choose a card from either hand to match the ${view.discardTop}. One attempt per discard.`;
  const it = view.interrupt;
  if (it?.kind === 'give') return it.giver === me ? `Match! Choose one of your cards to give ${n(it.receiver)}, or keep them all.` : `${n(it.giver)} is choosing a card to give…`;
  if (it?.kind === 'mismatch')
    return it.owner === me ? `${n(it.matcher)} wrongly tried your ${it.value}. Make them take it, or return it and give them a penalty card?` : `Wrong match — that was a ${it.value}. ${n(it.owner)} is deciding your penalty…`;
  const final = view.caller !== null ? ' (final turn)' : '';
  if (view.current !== me) return `${n(view.current)} is playing${final}…`;
  if (view.step === 'start') return `Your turn${final}: draw from the deck${view.discardTop !== null ? ', take the discard' : ''}${view.can.callKombio ? ', or call KOMBIO' : ''}.`;
  if (view.step === 'holding') {
    const v = view.held!.value;
    return view.held!.source === 'deck' ? `You drew a ${v}. Click one of your cards to exchange it, or discard it${v !== null && v >= 7 ? ' to use its ability' : ''}.` : `You took the ${v}. Click one of your cards to exchange it.`;
  }
  const ab = view.ability!;
  const label = ABILITY_LABELS[ab.ability];
  if (ab.stage === 'choose') {
    switch (ab.ability) {
      case 'peekOwn':
        return `${label}: click one of your cards to look at it.`;
      case 'peekOpponent':
        return `${label}: click one of your opponent's cards to look at it.`;
      case 'blindSwap':
        return `${label}: click two cards (any hands) to swap them${ui.pick ? ' — now pick the second card' : ''}.`;
      case 'lookAndSwap':
        return `${label}: click any card to look at it.`;
      case 'doubleLookAndSwap':
        return `${label}: click two cards to look at${ui.pick ? ' — now pick the second card' : ''}.`;
    }
  }
  return ab.ability === 'lookAndSwap'
    ? `You see a ${valueAt(view, ab.viewed[0])}. Click another card to exchange it with, or keep the cards.`
    : `You see ${ab.viewed.map((r) => valueAt(view, r)).join(' and ')}. Swap them?`;
}

function valueAt(view: PlayerView, r: SlotRef | undefined): string {
  if (!r) return '?';
  return String(view.hands[r.player].slots[r.slot]?.value ?? '?');
}

export function renderBoard(view: PlayerView, h: BoardHandlers): void {
  const me = view.viewer;
  const opp = me === 0 ? 1 : 0;
  const { ui } = h;
  const it = view.interrupt;

  $('score').textContent = `${view.players.map((p, i) => `${p} ${view.scores[i]}`).join(' · ')} · Round ${view.roundNumber}`;
  $('deckcount').textContent = `Draw deck · ${view.deckCount}`;
  $('discard').textContent = view.discardTop === null ? '—' : String(view.discardTop);
  $('turn').textContent =
    view.phase === 'ended' ? 'Round complete' : view.phase === 'memorize' ? 'Memorizing' : view.current === me ? 'Your turn' : `${view.players[view.current]}'s turn`;
  if (view.caller !== null && view.phase !== 'ended') $('turn').textContent += ` · ${view.players[view.caller]} called KOMBIO`;

  // Held card.
  const held = view.held;
  ($('heldbox') as HTMLElement).hidden = !held;
  if (held) {
    const hb = $('held');
    hb.textContent = held.value === null ? '✦' : String(held.value);
    hb.className = held.value === null ? 'card back' : 'card';
    $('heldlabel').textContent = held.holder === me ? 'Your drawn card' : `${view.players[held.holder]}'s drawn card`;
  }

  const viewedByMe = view.ability && view.current === me ? view.ability.viewed : [];
  const revealed: SlotRef[] = it?.kind === 'mismatch' ? [{ player: it.owner, slot: it.slot }] : [];
  const handEl = (player: number) =>
    view.hands[player].slots.map((slot) => {
      const ref = { player, slot: slot.slot };
      const faceUp =
        view.phase === 'ended' ||
        (view.phase === 'memorize' && player === me) ||
        has(ui.flash, ref) ||
        has(viewedByMe, ref) ||
        has(revealed, ref);
      return renderCard({
        ref,
        slot,
        faceUp,
        selected: same(ui.pick, ref),
        viewed: has(viewedByMe, ref),
        locked: view.hands[player].locked,
        onClick: (r) => onCardClick(view, h, r),
      });
    });
  $('hand').replaceChildren(...handEl(me));
  $('enemy').replaceChildren(...handEl(opp));
  $('message').textContent = messageFor(view, ui);
  $('error').textContent = ui.error;
  $('log').replaceChildren(
    ...ui.log.map((t) => {
      const d = document.createElement('div');
      d.textContent = `• ${t}`;
      return d;
    }),
  );

  // Actions.
  $('actions').replaceChildren();
  const d = h.dispatch;
  if (view.phase === 'memorize' && view.can.ready) button('Ready — hide cards', () => d({ type: 'ready', player: me }), 'primary');
  if (view.phase === 'ended') {
    if (view.gameOver) button('New game', h.newGame, 'primary');
    else button('Next round', () => d({ type: 'nextRound', player: me }), 'primary');
    return;
  }
  if (it?.kind === 'give' && it.giver === me) button('Keep my cards', () => d({ type: 'declineGive', player: me }));
  if (it?.kind === 'mismatch' && it.owner === me) {
    button('They take the card', () => d({ type: 'resolveMismatch', player: me, choice: 'matcherTakes' }), 'primary');
    button('Return it + penalty card', () => d({ type: 'resolveMismatch', player: me, choice: 'returnAndPenalty' }));
  }
  if (view.can.drawDeck) button('Draw from deck', () => d({ type: 'drawDeck', player: me }), 'primary');
  if (view.can.takeDiscard) button(`Take discard (${view.discardTop})`, () => d({ type: 'takeDiscard', player: me }));
  if (view.can.callKombio) button('Call KOMBIO!', () => d({ type: 'callKombio', player: me }), 'gold');
  if (view.can.pass) button('Pass (no legal move)', () => d({ type: 'pass', player: me }));
  if (view.current === me && !it) {
    if (view.step === 'holding' && held?.source === 'deck') {
      const v = held.value!;
      button(`Discard ${v}${v >= 7 ? ' & use ability' : ''}`, () => d({ type: 'discardHeld', player: me }), 'primary');
    }
    if (view.step === 'ability' && view.ability) {
      const ab = view.ability;
      if (ab.ability === 'doubleLookAndSwap' && ab.stage === 'decide' && ab.viewed.length === 2)
        button('Swap the two cards', () => d({ type: 'useSwap', player: me, a: ab.viewed[0], b: ab.viewed[1] }), 'primary');
      button(ab.stage === 'decide' ? 'Keep cards' : 'Skip ability', () => {
        ui.pick = null;
        d({ type: 'skipAbility', player: me });
      });
    }
  }
  if (view.can.match) {
    button(
      ui.matchMode ? 'Cancel match' : `Match the ${view.discardTop}`,
      () => {
        ui.matchMode = !ui.matchMode;
        ui.pick = null;
        h.rerender();
      },
      ui.matchMode ? 'active' : '',
    );
  }
}
