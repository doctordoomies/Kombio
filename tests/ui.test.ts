// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import html from '../index.html?raw';

/**
 * Browser-integration smoke test: loads the real index.html markup and main.ts,
 * then plays through rounds by clicking buttons, with the CPU driven by timers.
 */
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));

const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('#actions button')];
const find = (re: RegExp) => buttons().find((b) => re.test(b.textContent ?? ''));
const text = (id: string) => document.getElementById(id)!.textContent ?? '';
const enemyFaces = () => [...document.querySelectorAll('#enemy .card:not(.empty)')].map((b) => b.textContent);

async function boot() {
  vi.resetModules();
  document.body.innerHTML = body;
  await import('../src/main');
}

/** Plays the human's turns by drawing and discarding (skipping abilities) until the round ends. */
function playRound(callAfter = Infinity): void {
  let turns = 0;
  for (let i = 0; i < 2000; i++) {
    if (find(/Next round|New game/)) return;
    const ready = find(/Ready/);
    if (ready) ready.click();
    else if (find(/They take the card/)) find(/They take the card/)!.click();
    else if (find(/Keep my cards/)) find(/Keep my cards/)!.click();
    else if (find(/Call KOMBIO/) && turns >= callAfter) find(/Call KOMBIO/)!.click();
    else if (find(/Draw from deck/)) {
      turns++;
      find(/Draw from deck/)!.click();
    } else if (find(/^Discard/)) find(/^Discard/)!.click();
    else if (find(/Skip ability|Keep cards/)) find(/Skip ability|Keep cards/)!.click();
    else if (find(/Pass/)) find(/Pass/)!.click();
    // During play, the CPU's cards are never shown face up to us (we never peek in this test).
    if (!find(/Next round|New game/)) expect(enemyFaces().every((t) => t === '✦')).toBe(true);
    vi.advanceTimersByTime(2000);
  }
  throw new Error('round did not finish');
}

describe('browser UI', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts in the memorization phase showing only the bottom two cards', async () => {
    await boot();
    const faces = [...document.querySelectorAll('#hand .card')].map((b) => b.textContent);
    expect(faces).toHaveLength(4);
    expect(faces.slice(0, 2)).toEqual(['✦', '✦']);
    expect(faces.slice(2).every((f) => f !== '✦')).toBe(true);
    expect(find(/Ready/)).toBeTruthy();
    expect(text('discard')).toBe('—');
  });

  it('plays a full round to scoring when the human calls KOMBIO', async () => {
    await boot();
    playRound(2);
    expect(text('log')).toMatch(/called KOMBIO|Automatic KOMBIO/);
    expect(text('message')).toMatch(/Round scores/);
    expect(text('score')).toMatch(/Round 1/);
    // All cards revealed at the end.
    expect(enemyFaces().some((t) => t !== '✦')).toBe(true);
    find(/Next round/)!.click();
    expect(text('score')).toMatch(/Round 2/);
    expect(find(/Ready/)).toBeTruthy();
  });

  it('plays several rounds with the CPU deciding when to call', async () => {
    await boot();
    for (let round = 1; round <= 3; round++) {
      playRound();
      expect(text('message')).toMatch(/Round scores/);
      find(/Next round/)!.click();
    }
    expect(text('score')).toMatch(/Round 4/);
  });

  it('drawing then clicking one of your cards exchanges it', async () => {
    await boot();
    find(/Ready/)!.click();
    vi.advanceTimersByTime(100);
    find(/Draw from deck/)!.click();
    expect(document.getElementById('heldbox')!.hidden).toBe(false);
    const held = text('held');
    document.querySelector<HTMLButtonElement>('#hand .card')!.click();
    expect(document.getElementById('heldbox')!.hidden).toBe(true);
    expect(text('log')).toMatch(/You exchanged card 1/);
    expect(held).not.toBe('✦');
  });

  it('match mode lets the human attempt a match on the opponent\'s card', async () => {
    await boot();
    find(/Ready/)!.click();
    vi.advanceTimersByTime(100);
    find(/Draw from deck/)!.click();
    find(/^Discard/)!.click();
    // If the discard had an ability, skip it; then it is the CPU's turn.
    find(/Skip ability/)?.click();
    const matchBtn = find(/Match the/);
    expect(matchBtn).toBeTruthy();
    matchBtn!.click();
    expect(text('message')).toMatch(/Choose a card/);
    document.querySelector<HTMLButtonElement>('#enemy .card')!.click();
    expect(text('log')).toMatch(/You matched CPU's card 1|You tried to match CPU's card 1/);
    // The attempt is used up for this discard.
    expect(find(/Match the/)).toBeUndefined();
  });
});
