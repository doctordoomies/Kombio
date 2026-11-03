import './style.css';
import { renderGame, send, toggleMatch, type BoardContext, type UiState } from './ui/board';
import { GameController, HUMAN } from './ui/controller';
import { describeSettings, loadSettings, saveSettings, type GameSettings } from './ui/settings';
import { bindSetup, writeSetupForm } from './ui/setup';

const $ = (id: string) => document.getElementById(id)!;

let game: GameController | null = null;
const ui: UiState = { matchMode: false, pick: null, error: '', summaryDismissed: null };

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

function ctx(): BoardContext {
  return { game: game!, ui, rerender: render, newGame: showSetup };
}

function render(): void {
  if (game) renderGame(ctx());
}

function showSetup(): void {
  game?.pause();
  writeSetupForm(game?.settings ?? loadSettings());
  ($('resume-game') as HTMLElement).hidden = !game || game.state.gameOver;
  ($('setup') as HTMLElement).hidden = false;
  ($('game') as HTMLElement).hidden = true;
  ($('summary') as HTMLElement).hidden = true;
  ($('new-game') as HTMLElement).hidden = true;
}

function showGame(): void {
  ($('setup') as HTMLElement).hidden = true;
  ($('game') as HTMLElement).hidden = false;
  ($('new-game') as HTMLElement).hidden = false;
  $('settings-summary').textContent = describeSettings(game!.settings).slice(0, 3).join(' · ');
  render();
}

function startGame(settings: GameSettings): void {
  saveSettings(settings);
  game?.dispose();
  Object.assign(ui, { matchMode: false, pick: null, error: '', summaryDismissed: null });
  game = new GameController(settings, randomSeed(), render);
  showGame();
}

bindSetup(startGame, () => {
  game?.resume();
  showGame();
});
$('new-game').addEventListener('click', showSetup);

$('deck').addEventListener('click', () => {
  if (game?.view().can.drawDeck) send(ctx(), { type: 'drawDeck', player: HUMAN });
});
$('discard').addEventListener('click', () => {
  if (!game) return;
  const view = game.view();
  if (view.can.takeDiscard) send(ctx(), { type: 'takeDiscard', player: HUMAN });
  else if (ui.matchMode) {
    ui.error = 'In match mode, click the card in a hand that matches the discard.';
    render();
  }
});

// Desktop keyboard shortcuts (ignored while typing in the setup form).
document.addEventListener('keydown', (e) => {
  if (!game || ($('game') as HTMLElement).hidden || e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return;
  const view = game.view();
  const key = e.key.toLowerCase();
  if (key === 'd' && view.can.drawDeck) send(ctx(), { type: 'drawDeck', player: HUMAN });
  else if (key === 't' && view.can.takeDiscard) send(ctx(), { type: 'takeDiscard', player: HUMAN });
  else if (key === 'm') toggleMatch(ctx());
  else if (key === 's' && view.step === 'ability' && view.current === HUMAN && !view.interrupt) send(ctx(), { type: 'skipAbility', player: HUMAN });
  else if (key === 'escape') {
    ui.matchMode = false;
    ui.pick = null;
    ui.error = '';
    render();
  } else return;
  e.preventDefault();
});

showSetup();
