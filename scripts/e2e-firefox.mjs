#!/usr/bin/env node
/**
 * Real-browser end-to-end check using Firefox's built-in WebDriver BiDi.
 * No extra dependencies: Node's WebSocket client talks to headless Firefox.
 *
 *   npm run build && npm run test:e2e
 *
 * Plays complete games (2, 3 and 4 players) through the production build at a
 * desktop resolution, asserts there are no page errors and that opponents'
 * cards stay hidden during play, and saves screenshots to e2e-artifacts/.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PREVIEW_PORT = 4317;
const BIDI_PORT = 9333;
const OUT = process.env.E2E_OUT ?? 'e2e-artifacts';
const FIREFOX = process.env.FIREFOX ?? 'firefox';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, what, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* not ready yet */
    }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}

class Bidi {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.errors = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.type === 'error') reject(new Error(`${msg.error}: ${msg.message}`));
        else resolve(msg.result);
      } else if (msg.method === 'log.entryAdded' && msg.params.level === 'error') {
        this.errors.push(msg.params.text);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

/** Runs in the page: performs one human step, mirroring a simple player. Returns a status string. */
const STEP = `(() => {
  const vis = (id) => !document.getElementById(id).hidden;
  const btn = (re, id = 'actions') => [...document.querySelectorAll('#' + id + ' button')].find((b) => re.test(b.textContent));
  const opp = [...document.querySelectorAll('.area:not(.area-bottom) .seat .card:not(.empty)')].map((c) => c.textContent);
  if (vis('summary')) return 'summary';
  const hiddenOk = opp.every((t) => t === '✦');
  const click = (b, label) => { b.click(); return label + (hiddenOk ? '' : ' LEAK'); };
  let b;
  if ((b = btn(/Ready/))) return click(b, 'ready');
  if ((b = btn(/ takes the /))) return click(b, 'resolve');
  if ((b = btn(/Keep my cards/))) return click(b, 'keep');
  window.__turns = window.__turns || 0;
  if ((b = btn(/Call KOMBIO/)) && window.__turns >= 4) { window.__turns = 0; return click(b, 'kombio'); }
  if ((b = btn(/Draw from deck/))) { window.__turns++; return click(b, 'draw'); }
  if ((b = btn(/^Discard/))) return click(b, 'discard');
  if ((b = btn(/Skip ability|Keep cards/))) return click(b, 'skip');
  if ((b = btn(/Pass/))) return click(b, 'pass');
  return 'wait' + (hiddenOk ? '' : ' LEAK');
})()`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), 'kombio-ff-'));
  const preview = spawn('npx', ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort'], { stdio: 'ignore' });
  const firefox = spawn(FIREFOX, ['--headless', '--no-remote', '-profile', profile, `--remote-debugging-port=${BIDI_PORT}`, 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => {
    firefox.kill();
    preview.kill();
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };
  try {
    await waitFor(() => fetch(`http://localhost:${PREVIEW_PORT}/`).then((r) => r.ok), 'vite preview');
    const ws = await waitFor(
      () =>
        new Promise((resolve, reject) => {
          const s = new WebSocket(`ws://127.0.0.1:${BIDI_PORT}/session`);
          s.addEventListener('open', () => resolve(s));
          s.addEventListener('error', reject);
        }),
      'Firefox WebDriver BiDi',
    );
    const bidi = new Bidi(ws);
    await bidi.send('session.new', { capabilities: {} });
    await bidi.send('session.subscribe', { events: ['log.entryAdded'] });
    const { contexts } = await bidi.send('browsingContext.getTree', {});
    const context = contexts[0].context;
    await bidi.send('browsingContext.setViewport', { context, viewport: { width: 1440, height: 1000 } });
    const evaluate = async (expression) => {
      const r = await bidi.send('script.evaluate', { expression, target: { context }, awaitPromise: false });
      if (r.type === 'exception') throw new Error(`page exception: ${r.exceptionDetails.text}`);
      return r.result.value;
    };
    const shot = async (name) => {
      const { data } = await bidi.send('browsingContext.captureScreenshot', { context, origin: 'document' });
      writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
      console.log(`  screenshot ${join(OUT, name)}.png`);
    };

    for (const players of [2, 3, 4]) {
      console.log(`\n${players}-player game`);
      await bidi.send('browsingContext.navigate', { context, url: `http://localhost:${PREVIEW_PORT}/`, wait: 'complete' });
      const errorsBefore = bidi.errors.length;
      await evaluate(`localStorage.clear()`);
      await evaluate(`(() => {
        const pick = (n, v) => { const i = document.querySelector('input[name="' + n + '"][value="' + v + '"]'); i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); };
        pick('players', '${players}'); pick('difficulty', '${['easy', 'normal', 'hard'][players - 2]}');
        const r = document.querySelector('input[name="rounds"]'); r.value = '2'; r.dispatchEvent(new Event('change', { bubbles: true }));
        pick('length', 'rounds');
      })()`);
      if (players === 4) await shot('01-setup');
      // Real computed styles: only the setup screen is visible before the game starts.
      const layout = await evaluate(`[getComputedStyle(document.getElementById('setup')).display, getComputedStyle(document.getElementById('game')).display, getComputedStyle(document.getElementById('summary')).display].join(',')`);
      if (!/^(block|grid|flex),none,none$/.test(layout)) throw new Error(`setup screen layout wrong (setup,game,summary display = ${layout})`);
      await evaluate(`document.getElementById('start-game').click()`);
      if (players === 4) await shot('02-memorize-4p');
      const gameLayout = await evaluate(`[getComputedStyle(document.getElementById('setup')).display, getComputedStyle(document.getElementById('game')).display].join(',')`);
      if (gameLayout !== 'none,grid') throw new Error(`game screen layout wrong (setup,game display = ${gameLayout})`);
      let rounds = 0;
      let midShot = false;
      for (let i = 0; i < 2000 && rounds < 2; i++) {
        const status = await evaluate(STEP);
        if (status.includes('LEAK')) throw new Error('an opponent card was face up during play');
        if (status === 'draw' && !midShot && players >= 3) {
          await sleep(100);
          await shot(`03-holding-${players}p`);
          midShot = true;
        }
        if (status === 'summary') {
          rounds++;
          await shot(`04-summary-${players}p-round${rounds}`);
          const over = await evaluate(`/Game over/.test(document.getElementById('summary-body').textContent)`);
          if (rounds === 2) {
            if (!over) throw new Error('game did not end after 2 rounds');
            break;
          }
          await evaluate(`[...document.querySelectorAll('#summary-actions button')].find((b) => /Next round/.test(b.textContent)).click()`);
        }
        await sleep(status === 'wait' ? 400 : 150);
      }
      if (rounds < 2) throw new Error(`${players}-player game did not finish`);
      const scores = await evaluate(`[...document.querySelectorAll('#scoreboard tbody tr')].map((tr) => tr.textContent).join(' | ')`);
      console.log(`  finished: ${scores}`);
      const pageErrors = bidi.errors.slice(errorsBefore);
      if (pageErrors.length) throw new Error(`page errors:\n${pageErrors.join('\n')}`);
    }
    console.log('\nE2E PASSED: 2-, 3- and 4-player games completed in Firefox with no page errors or hidden-card leaks.');
    await bidi.send('session.end', {}).catch(() => {});
  } finally {
    cleanup();
  }
}

main().catch((e) => {
  console.error(`\nE2E FAILED: ${e.message}`);
  process.exit(1);
});
