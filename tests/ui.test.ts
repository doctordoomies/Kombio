// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import html from '../index.html?raw';

/**
 * Browser-integration tests: load the real index.html markup and main.ts, then
 * play through games by clicking, with the CPUs driven by (fake) timers.
 */
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));

const $ = (id: string) => document.getElementById(id)!;
const buttonsIn = (id: string) => [...document.querySelectorAll<HTMLButtonElement>(`#${id} button`)];
const find = (re: RegExp, id = 'actions') => buttonsIn(id).find((b) => re.test(b.textContent ?? ''));
const text = (id: string) => $(id).textContent ?? '';
const visible = (id: string) => !($(id) as HTMLElement).hidden;
const opponentFaces = () => [...document.querySelectorAll('.area:not(.area-bottom) .seat .card:not(.empty)')].map((b) => b.textContent);
const myCards = () => [...document.querySelectorAll<HTMLButtonElement>('#hand .card')];

async function boot(seed = 4242) {
  vi.resetModules();
  localStorage.clear();
  document.body.innerHTML = body;
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(arr: T): T => {
    (arr as unknown as Uint32Array)[0] = seed;
    return arr;
  });
  await import('../src/main');
}

function choose(name: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)!;
  input.checked = true;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function setNumber(name: string, value: number) {
  const input = document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function start(players: number, difficulty = 'normal', length: 'unlimited' | 'rounds' | 'score' = 'rounds', n = 1) {
  choose('players', String(players));
  choose('difficulty', difficulty);
  if (length === 'rounds') setNumber('rounds', n);
  if (length === 'score') setNumber('scoreLimit', n);
  choose('length', length);
  $('start-game').click();
}

interface PlayOptions {
  callAfterTurns?: number;
  /** Return true if the test handled the drawn card itself. */
  onHeld?: (value: number) => boolean;
  checkHidden?: boolean;
}

/** Plays the human seat by clicking until the round summary appears. */
function playRound(opts: PlayOptions = {}): void {
  let turns = 0;
  for (let i = 0; i < 4000; i++) {
    if (visible('summary')) return;
    const held = $('heldbox').hidden ? null : Number(text('held'));
    if (find(/Ready/)) find(/Ready/)!.click();
    else if (find(/ takes the /)) find(/ takes the /)!.click();
    else if (find(/Keep my cards/)) find(/Keep my cards/)!.click();
    else if (find(/Call KOMBIO/) && turns >= (opts.callAfterTurns ?? Infinity)) find(/Call KOMBIO/)!.click();
    else if (find(/Draw from deck/)) {
      turns++;
      find(/Draw from deck/)!.click();
    } else if (held !== null && Number.isFinite(held) && find(/^Discard/) && opts.onHeld?.(held)) {
      /* handled by the test */
    } else if (find(/^Discard/)) find(/^Discard/)!.click();
    else if (find(/Skip ability|Keep cards/)) find(/Skip ability|Keep cards/)!.click();
    else if (find(/Pass/)) find(/Pass/)!.click();
    if (opts.checkHidden !== false && !visible('summary')) {
      // We never peek at opponents here, so their cards must stay face down during play.
      expect(opponentFaces().every((t) => t === '✦')).toBe(true);
    }
    vi.advanceTimersByTime(3000);
  }
  throw new Error('round did not finish');
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('setup screen', () => {
  it('shows all settings before the game starts and updates them live', async () => {
    await boot();
    expect(visible('setup')).toBe(true);
    expect(visible('game')).toBe(false);
    expect(text('setup-summary-list')).toMatch(/2 players: you \+ 1 CPU opponent/);
    expect(text('setup-summary-list')).toMatch(/CPU difficulty: Normal/);
    expect(text('setup-summary-list')).toMatch(/Game length: 5 rounds/);
    choose('players', '4');
    choose('difficulty', 'hard');
    setNumber('scoreLimit', 80);
    expect(text('setup-summary-list')).toMatch(/4 players: you \+ 3 CPU opponents/);
    expect(text('setup-summary-list')).toMatch(/CPU difficulty: Hard/);
    // Typing a score limit selects the score-limit mode.
    expect(text('setup-summary-list')).toMatch(/until someone reaches 80 points/);
    choose('length', 'unlimited');
    expect(text('setup-summary-list')).toMatch(/unlimited rounds/);
  });

  it('starts a game with the chosen settings and remembers them', async () => {
    await boot();
    start(3, 'easy', 'rounds', 3);
    expect(visible('game')).toBe(true);
    expect(text('settings-summary')).toMatch(/3 players.*Easy.*3 rounds/);
    expect(document.querySelectorAll('.area:not(.area-bottom) .seat')).toHaveLength(2);
    expect($('area-left').querySelector('#seat-1')).toBeTruthy();
    expect($('area-right').querySelector('#seat-2')).toBeTruthy();
    expect(text('seat-1')).toMatch(/CPU 1.*Easy/);
    expect(text('scoreboard')).toMatch(/Round 1 of 3/);
    // Back to setup: the form shows the current settings and offers to resume.
    $('new-game').click();
    expect(visible('setup')).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[name="players"][value="3"]')!.checked).toBe(true);
    expect(visible('resume-game')).toBe(true);
    $('resume-game').click();
    expect(visible('game')).toBe(true);
  });

  it('lays out 2, 3 and 4 players around the table', async () => {
    const layouts: [number, string[]][] = [
      [2, ['top']],
      [3, ['left', 'right']],
      [4, ['left', 'top', 'right']],
    ];
    for (const [players, areas] of layouts) {
      await boot();
      start(players);
      for (const a of ['left', 'top', 'right']) expect($(`area-${a}`).children.length).toBe(areas.includes(a) ? 1 : 0);
    }
  });
});

describe('desktop game', () => {
  it('memorization shows only your bottom two cards; opponents stay hidden', async () => {
    await boot();
    start(4);
    const faces = myCards().map((b) => b.textContent);
    expect(faces.slice(0, 2)).toEqual(['✦', '✦']);
    expect(faces.slice(2).every((f) => f !== '✦')).toBe(true);
    expect(opponentFaces().every((f) => f === '✦')).toBe(true);
    expect(text('turn-banner')).toMatch(/memorize/);
  });

  it('shows whose turn it is', async () => {
    await boot();
    start(3);
    find(/Ready/)!.click();
    vi.advanceTimersByTime(10);
    expect(text('turn-banner')).toMatch(/Your turn/);
    expect($('seat-0').classList.contains('active')).toBe(true);
    find(/Draw from deck/)!.click();
    myCards()[0].click();
    expect(text('turn-banner')).toMatch(/CPU 1's turn/);
    expect($('seat-1').classList.contains('active')).toBe(true);
    expect(text('seat-1')).toMatch(/TURN/);
  });

  it('highlights valid targets and explains invalid clicks without changing the game', async () => {
    await boot();
    start(2);
    find(/Ready/)!.click();
    vi.advanceTimersByTime(10);
    find(/Draw from deck/)!.click();
    expect(myCards().every((c) => c.classList.contains('target'))).toBe(true);
    const enemy = document.querySelector<HTMLButtonElement>('#seat-1 .card')!;
    expect(enemy.classList.contains('dim')).toBe(true);
    const logBefore = text('log');
    enemy.click();
    expect(text('error')).toMatch(/one of your own cards/);
    expect(text('log')).toBe(logBefore);
    expect(visible('heldbox')).toBe(true);
    myCards()[1].click();
    expect(text('error')).toBe('');
    expect(text('log')).toMatch(/You exchanged card 2/);
  });

  it('clicking a card when it is not your turn gives feedback', async () => {
    await boot();
    start(2);
    find(/Ready/)!.click();
    vi.advanceTimersByTime(10);
    find(/Draw from deck/)!.click();
    myCards()[0].click(); // now the CPU's turn
    myCards()[1].click();
    expect(text('error')).toMatch(/not your turn/);
  });

  it('keyboard: D draws, M toggles match mode, Escape cancels', async () => {
    await boot();
    start(2);
    find(/Ready/)!.click();
    vi.advanceTimersByTime(10);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
    expect(visible('heldbox')).toBe(true);
    myCards()[0].click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
    expect(text('message')).toMatch(/Match mode/);
    expect(document.querySelectorAll('#seat-1 .card.target').length).toBeGreaterThan(0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(text('message')).not.toMatch(/Match mode/);
  });

  it('match mode targets cards in any hand and resolves the attempt', async () => {
    await boot();
    start(3);
    find(/Ready/)!.click();
    vi.advanceTimersByTime(10);
    find(/Draw from deck/)!.click();
    find(/^Discard/)!.click();
    find(/Skip ability/)?.click();
    find(/Match the/)!.click();
    document.querySelector<HTMLButtonElement>('#seat-2 .card')!.click();
    expect(text('log')).toMatch(/You matched CPU 2's card 1|You tried to match CPU 2's card 1/);
    expect(find(/Match the/)).toBeUndefined();
  });

  it.each([2, 3, 4])('plays a complete %i-player game to the final results', async (players) => {
    await boot(1000 + players);
    start(players, 'normal', 'rounds', 2);
    playRound({ callAfterTurns: 3 });
    expect(text('summary-title')).toMatch(/Round 1 summary/);
    expect(document.querySelectorAll('#summary-body tbody tr')).toHaveLength(players);
    // All hands are revealed at the end of the round.
    expect(opponentFaces().some((t) => t !== '✦')).toBe(true);
    find(/Next round/, 'summary-actions')!.click();
    expect(visible('summary')).toBe(false);
    expect(text('scoreboard')).toMatch(/Round 2 of 2/);
    playRound({ callAfterTurns: 3 });
    expect(text('summary-title')).toMatch(/Final results/);
    expect(text('summary-body')).toMatch(/Game over/);
    // The scoreboard shows both rounds, and the totals add up.
    const rows = [...document.querySelectorAll('#scoreboard tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent));
    expect(rows).toHaveLength(players);
    for (const r of rows) expect(Number(r[1]) + Number(r[2])).toBe(Number(r[3]));
    find(/New game/, 'summary-actions')!.click();
    expect(visible('setup')).toBe(true);
  });

  it('round summary can be dismissed to view the revealed table and reopened', async () => {
    await boot();
    start(2, 'normal', 'unlimited');
    playRound({ callAfterTurns: 2 });
    find(/View table/, 'summary-actions')!.click();
    expect(visible('summary')).toBe(false);
    find(/Show summary/)!.click();
    expect(visible('summary')).toBe(true);
  });

  it('blind swap (11/12): select two opponent cards by clicking', async () => {
    await boot(7);
    start(3, 'normal', 'unlimited');
    let swapped = false;
    for (let round = 0; round < 8 && !swapped; round++) {
      playRound({
        checkHidden: false,
        onHeld: (v) => {
          if (swapped || (v !== 11 && v !== 12)) return false;
          find(/^Discard/)!.click();
          expect(text('message')).toMatch(/Blind swap/);
          document.querySelector<HTMLButtonElement>('#seat-1 .card:not(.empty)')!.click();
          expect(document.querySelector('#seat-1 .card.selected')).toBeTruthy();
          document.querySelector<HTMLButtonElement>('#seat-2 .card:not(.empty)')!.click();
          expect(text('log')).toMatch(/You swapped CPU 1's card \d with CPU 2's card \d/);
          swapped = true;
          return true;
        },
      });
      if (!swapped) find(/Next round/, 'summary-actions')!.click();
    }
    expect(swapped).toBe(true);
  });

  it("peek (9/10): look at one opponent's card; it is shown only briefly and others stay hidden", async () => {
    await boot(11);
    start(4, 'normal', 'unlimited');
    let peeked = false;
    for (let round = 0; round < 8 && !peeked; round++) {
      playRound({
        checkHidden: false,
        onHeld: (v) => {
          if (peeked || (v !== 9 && v !== 10)) return false;
          find(/^Discard/)!.click();
          const target = document.querySelector<HTMLButtonElement>('#seat-3 .card:not(.empty)')!;
          const slot = target.dataset.slot;
          target.click();
          expect(text('log')).toMatch(/You looked at CPU 3's card/);
          const card = () => document.querySelector<HTMLButtonElement>(`#seat-3 .card[data-slot="${slot}"]`)!;
          expect(card().textContent).not.toBe('✦');
          expect([...document.querySelectorAll('#seat-1 .card:not(.empty)')].every((c) => c.textContent === '✦')).toBe(true);
          vi.advanceTimersByTime(3000);
          // After the flash it is face down again (but marked as seen) — unless the CPU moved it.
          if (card()?.classList.contains('known')) expect(card().textContent).toBe('✦');
          peeked = true;
          return true;
        },
      });
      if (!peeked) find(/Next round/, 'summary-actions')!.click();
    }
    expect(peeked).toBe(true);
  });
});
