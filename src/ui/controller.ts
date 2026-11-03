import { decideAction, decideMatch, PROFILES, type Profile } from '../ai/opponent';
import type { Action, SlotRef } from '../engine/actions';
import { applyAction, createGame, type GameEvent, type GameState } from '../engine/game';
import { getPlayerView, type PlayerView } from '../engine/view';
import { describeEvent } from './log';
import { seatNames, settingsToRules, type GameSettings } from './settings';

export const HUMAN = 0;
const LOG_LIMIT = 60;
const FLASH_MS = 2500;
const HIGHLIGHT_MS = 1800;

export type HighlightKind = 'peek' | 'swap' | 'match' | 'miss' | 'replace' | 'give';

export interface Highlight {
  ref: SlotRef;
  kind: HighlightKind;
}

export interface LogEntry {
  text: string;
  player: number | null;
}

/**
 * Owns the authoritative GameState for a local game and drives the computer
 * opponents. The UI only ever reads the human's PlayerView from it; each CPU
 * only ever receives its own PlayerView.
 */
export class GameController {
  state: GameState;
  readonly settings: GameSettings;
  readonly profiles: (Profile | null)[];
  log: LogEntry[] = [];
  /** Cards the human is briefly shown face up (their own peeks, public reveals). */
  flash: SlotRef[] = [];
  /** Recently touched cards, so the human can follow what the CPUs did. */
  highlights: Highlight[] = [];
  private cpuTimers = new Map<number, { key: string; timer: ReturnType<typeof setTimeout> }>();
  private flashTimer: ReturnType<typeof setTimeout> | undefined;
  private highlightTimer: ReturnType<typeof setTimeout> | undefined;
  private paused = false;
  private readonly aiSeed: number;

  constructor(
    settings: GameSettings,
    seed: number,
    private readonly onChange: () => void,
  ) {
    this.settings = settings;
    const created = createGame({ players: seatNames(settings), seed, rules: settingsToRules(settings) });
    this.state = created.state;
    this.profiles = this.state.players.map((_, i) => (i === HUMAN ? null : PROFILES[settings.difficulty]));
    this.aiSeed = seed ^ 0x5bd1e995;
    this.record(created.events);
    this.schedule();
  }

  view(player = HUMAN): PlayerView {
    return getPlayerView(this.state, player);
  }

  /** Applies an action through the engine. Rejected actions leave the state untouched. */
  dispatch(action: Action): { ok: true } | { ok: false; error: string } {
    const result = applyAction(this.state, action);
    if (!result.ok) {
      this.schedule();
      return { ok: false, error: result.error };
    }
    this.state = result.state;
    this.record(result.events);
    this.react(result.events);
    this.onChange();
    this.schedule();
    return { ok: true };
  }

  pause(): void {
    this.paused = true;
    this.clearCpuTimers();
  }

  resume(): void {
    this.paused = false;
    this.schedule();
  }

  dispose(): void {
    this.pause();
    clearTimeout(this.flashTimer);
    clearTimeout(this.highlightTimer);
  }

  private record(events: GameEvent[]): void {
    const entries = events
      .map((e) => ({ text: describeEvent(e, this.state.players), player: 'player' in e ? e.player : null }))
      .filter((x): x is LogEntry => x.text !== null);
    this.log = [...entries.reverse(), ...this.log].slice(0, LOG_LIMIT);
  }

  private react(events: GameEvent[]): void {
    const flash: SlotRef[] = [];
    const highlights: Highlight[] = [];
    for (const e of events) {
      switch (e.type) {
        case 'peeked':
          if (e.player === HUMAN) flash.push(...e.targets);
          else highlights.push(...e.targets.map((ref) => ({ ref, kind: 'peek' as const })));
          break;
        case 'swapped':
          highlights.push({ ref: e.a, kind: 'swap' }, { ref: e.b, kind: 'swap' });
          break;
        case 'mismatched':
          // Incorrect attempts are shown to the whole table.
          if (e.target.player === e.player) flash.push(e.target);
          highlights.push({ ref: e.target, kind: 'miss' });
          break;
        case 'matched':
          highlights.push({ ref: e.target, kind: 'match' });
          break;
        case 'replaced':
          highlights.push({ ref: { player: e.player, slot: e.slot }, kind: 'replace' });
          break;
        case 'gave':
          highlights.push({ ref: { player: e.to, slot: e.slot }, kind: 'give' });
          break;
      }
    }
    if (flash.length) {
      this.flash = flash;
      clearTimeout(this.flashTimer);
      this.flashTimer = setTimeout(() => {
        this.flash = [];
        this.onChange();
      }, FLASH_MS);
    }
    if (highlights.length) {
      this.highlights = highlights;
      clearTimeout(this.highlightTimer);
      this.highlightTimer = setTimeout(() => {
        this.highlights = [];
        this.onChange();
      }, HIGHLIGHT_MS);
    }
  }

  private clearCpuTimers(): void {
    for (const t of this.cpuTimers.values()) clearTimeout(t.timer);
    this.cpuTimers.clear();
  }

  /**
   * After every change, each CPU looks at its own view and decides whether to
   * act. Matches race on a per-difficulty delay, so a quick human can win. A
   * pending decision that is still the same keeps its timer, so one CPU's
   * actions don't keep resetting another CPU's reaction time.
   */
  private schedule(): void {
    if (this.paused || this.state.gameOver || this.state.round.phase === 'ended') {
      this.clearCpuTimers();
      return;
    }
    this.profiles.forEach((profile, seat) => {
      if (!profile) return;
      const seed = this.aiSeed + seat * 7919;
      const view = getPlayerView(this.state, seat);
      const decision = decideMatch(view, profile, seed) ?? decideAction(view, profile, seed);
      // A match stays pending while the discard pile is unchanged; other decisions reset on any table change.
      const key = !decision ? '' : decision.type === 'match' ? `${JSON.stringify(decision)}@${view.discardCount}` : `${JSON.stringify(decision)}@${view.discardCount}:${view.deckCount}:${view.step}`;
      const pending = this.cpuTimers.get(seat);
      if (pending && pending.key === key) return;
      if (pending) clearTimeout(pending.timer);
      this.cpuTimers.delete(seat);
      if (!decision) return;
      const delay = decision.type === 'match' ? profile.matchDelayMs : decision.type === 'ready' ? 0 : profile.turnDelayMs;
      const timer = setTimeout(() => {
        this.cpuTimers.delete(seat);
        // Re-decide from a fresh view: the table may have changed meanwhile.
        const fresh = getPlayerView(this.state, seat);
        const next = decideMatch(fresh, profile, seed) ?? decideAction(fresh, profile, seed);
        if (next) this.dispatch(next);
      }, delay);
      this.cpuTimers.set(seat, { key, timer });
    });
  }
}
