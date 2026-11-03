import './style.css';
import { decideAction, decideMatch } from './ai/opponent';
import { applyAction, createGame, getPlayerView, type Action, type GameEvent, type GameState, type SlotRef } from './engine';
import { describeEvent, renderBoard, type UiState } from './ui/board';

const HUMAN = 0;
const CPU = 1;
const CPU_TURN_DELAY_MS = 750;
/** How long the CPU "takes" to spot a match; the human can beat it to the discard. */
const CPU_MATCH_DELAY_MS = 1300;
const FLASH_MS = 2500;
const LOG_LIMIT = 40;

let state: GameState;
let cpuTimer: number | undefined;
let flashTimer: number | undefined;
const ui: UiState = { matchMode: false, pick: null, flash: [], error: '', log: [] };

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

function record(events: GameEvent[]): void {
  const lines = events.map((e) => describeEvent(e, state.players)).filter((x): x is string => x !== null);
  ui.log = [...lines.reverse(), ...ui.log].slice(0, LOG_LIMIT);
}

function flash(refs: SlotRef[]): void {
  ui.flash = refs;
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => {
    ui.flash = [];
    render();
  }, FLASH_MS);
}

function dispatch(action: Action): void {
  const result = applyAction(state, action);
  if (!result.ok) {
    if (action.player === HUMAN) {
      ui.error = result.error;
      render();
    }
    schedule();
    return;
  }
  state = result.state;
  ui.error = '';
  if (action.player === HUMAN) ui.matchMode = false;
  record(result.events);
  // Briefly show the human what they just looked at, and any card revealed to the whole table.
  const reveal: SlotRef[] = [];
  for (const e of result.events) {
    if (e.type === 'peeked' && e.player === HUMAN) reveal.push(...e.targets);
    if (e.type === 'mismatched' && e.target.player === e.player) reveal.push(e.target);
  }
  if (reveal.length) flash(reveal);
  render();
  schedule();
}

/** Lets the computer opponent act. It only ever sees its own PlayerView. */
function schedule(): void {
  window.clearTimeout(cpuTimer);
  if (state.round.phase === 'ended' || state.gameOver) return;
  const view = getPlayerView(state, CPU);
  const match = decideMatch(view);
  if (match) {
    cpuTimer = window.setTimeout(() => {
      const again = decideMatch(getPlayerView(state, CPU));
      if (again) dispatch(again);
      else schedule();
    }, CPU_MATCH_DELAY_MS);
    return;
  }
  const action = decideAction(view);
  if (action) cpuTimer = window.setTimeout(() => dispatch(action), action.type === 'ready' ? 0 : CPU_TURN_DELAY_MS);
}

function render(): void {
  renderBoard(getPlayerView(state, HUMAN), { dispatch, ui, rerender: render, newGame });
}

function newGame(): void {
  window.clearTimeout(cpuTimer);
  const created = createGame({ players: ['You', 'CPU'], seed: randomSeed() });
  state = created.state;
  Object.assign(ui, { matchMode: false, pick: null, flash: [], error: '', log: [] });
  record(created.events);
  render();
  schedule();
}

document.getElementById('deck')!.onclick = () => {
  if (getPlayerView(state, HUMAN).can.drawDeck) dispatch({ type: 'drawDeck', player: HUMAN });
};
document.getElementById('discard')!.onclick = () => {
  if (getPlayerView(state, HUMAN).can.takeDiscard) dispatch({ type: 'takeDiscard', player: HUMAN });
};

newGame();
