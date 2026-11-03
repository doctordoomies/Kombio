import type { PlayerView } from '../engine/view';
import { lengthLabel, type GameSettings } from './settings';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};

/** Cumulative scores with a per-round breakdown. */
export function renderScoreboard(view: PlayerView, settings: GameSettings): HTMLElement {
  const wrap = el('div');
  const progress =
    settings.length === 'rounds'
      ? `Round ${view.roundNumber} of ${settings.rounds}`
      : settings.length === 'score'
        ? `Round ${view.roundNumber} · game ends at ${settings.scoreLimit} points`
        : `Round ${view.roundNumber} · ${lengthLabel(settings)}`;
  wrap.append(el('p', progress, 'muted'));

  const table = el('table', undefined, 'scores');
  const head = el('tr');
  head.append(el('th', 'Player'));
  view.history.forEach((h) => head.append(el('th', `R${h.round}`)));
  head.append(el('th', 'Total'));
  table.append(el('thead'));
  table.tHead!.append(head);
  const body = el('tbody');
  const best = Math.min(...view.scores);
  view.players.forEach((name, p) => {
    const tr = el('tr');
    if (view.history.length && view.scores[p] === best) tr.className = 'leader';
    tr.append(el('td', name));
    view.history.forEach((h) => tr.append(el('td', String(h.roundScores[p]))));
    tr.append(el('td', String(view.scores[p])));
    body.append(tr);
  });
  table.append(body);
  wrap.append(table);
  if (!view.history.length) wrap.append(el('p', 'No rounds completed yet. Lowest total wins.', 'muted'));
  return wrap;
}

/** Contents of the end-of-round dialog. Only shown once the round has ended, when every hand is public. */
export function renderRoundSummary(view: PlayerView): { caller: string; body: HTMLElement } {
  const r = view.lastResult!;
  const n = (p: number) => view.players[p];
  let caller = 'Round over.';
  if (r.caller !== null) {
    caller = r.callerWon
      ? `${n(r.caller)} called KOMBIO with the lowest hand. Everyone else adds +10.`
      : `${n(r.caller)} called KOMBIO but was tied or beaten, so ${n(r.caller)} adds +15.`;
  }
  const table = el('table', undefined, 'summary-table');
  const head = el('tr');
  for (const h of ['Player', 'Revealed hand', 'Hand', 'Adjustment', 'Round', 'Total']) head.append(el('th', h));
  table.append(el('thead'));
  table.tHead!.append(head);
  const body = el('tbody');
  const lowestRound = Math.min(...r.roundScores);
  view.players.forEach((name, p) => {
    const tr = el('tr');
    if (r.roundScores[p] === lowestRound) tr.className = 'winner';
    tr.append(el('td', `${name}${r.caller === p ? ' (called KOMBIO)' : ''}`));
    const handCell = el('td');
    const mini = el('div', undefined, 'mini');
    if (r.hands[p].length === 0) mini.append(el('em', 'no cards'));
    for (const v of r.hands[p]) mini.append(el('span', String(v)));
    handCell.append(mini);
    tr.append(handCell);
    tr.append(el('td', String(r.handScores[p])));
    const adj = r.roundScores[p] - r.handScores[p];
    tr.append(el('td', adj ? `+${adj}` : '—', adj ? 'adj' : ''));
    tr.append(el('td', String(r.roundScores[p])));
    tr.append(el('td', String(view.scores[p])));
    body.append(tr);
  });
  table.append(body);
  const wrap = el('div');
  wrap.append(table);
  if (view.gameOver) {
    const names = view.winners.map(n).join(' & ');
    wrap.append(el('p', `Game over — ${names} win${view.winners.length === 1 && names !== 'You' ? 's' : ''} with ${view.scores[view.winners[0]]} points!`, 'gameover'));
  }
  return { caller, body: wrap };
}
