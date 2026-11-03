import type { Difficulty } from '../ai/opponent';
import type { RulesConfig } from '../engine/rules';

export type LengthMode = 'unlimited' | 'rounds' | 'score';

export interface GameSettings {
  /** Total players including you: 2–4 (1–3 CPU opponents). */
  players: number;
  difficulty: Difficulty;
  length: LengthMode;
  rounds: number;
  scoreLimit: number;
}

export const DEFAULT_SETTINGS: GameSettings = { players: 2, difficulty: 'normal', length: 'rounds', rounds: 5, scoreLimit: 100 };

export const LIMITS = { players: [2, 4], rounds: [1, 20], scoreLimit: [20, 500] } as const;

export const DIFFICULTY_INFO: Record<Difficulty, { label: string; blurb: string }> = {
  easy: { label: 'Easy', blurb: 'Forgets cards, makes careless moves, slow to match.' },
  normal: { label: 'Normal', blurb: 'Remembers what it sees and plays sensibly.' },
  hard: { label: 'Hard', blurb: 'Reads the table, targets the leader, quick to match.' },
};

const clampInt = (v: unknown, [lo, hi]: readonly [number, number], fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** Validates untrusted input (form values, localStorage) into settings. */
export function normalizeSettings(raw: unknown): GameSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    players: clampInt(r.players, LIMITS.players, d.players),
    difficulty: r.difficulty === 'easy' || r.difficulty === 'normal' || r.difficulty === 'hard' ? r.difficulty : d.difficulty,
    length: r.length === 'unlimited' || r.length === 'rounds' || r.length === 'score' ? r.length : d.length,
    rounds: clampInt(r.rounds, LIMITS.rounds, d.rounds),
    scoreLimit: clampInt(r.scoreLimit, LIMITS.scoreLimit, d.scoreLimit),
  };
}

export function settingsToRules(s: GameSettings): Partial<RulesConfig> {
  return {
    maxRounds: s.length === 'rounds' ? s.rounds : null,
    scoreLimit: s.length === 'score' ? s.scoreLimit : null,
  };
}

export function seatNames(s: GameSettings): string[] {
  return ['You', ...Array.from({ length: s.players - 1 }, (_, i) => `CPU ${i + 1}`)];
}

export function lengthLabel(s: GameSettings): string {
  if (s.length === 'rounds') return `${s.rounds} round${s.rounds === 1 ? '' : 's'}`;
  if (s.length === 'score') return `until someone reaches ${s.scoreLimit} points`;
  return 'unlimited rounds';
}

export function describeSettings(s: GameSettings): string[] {
  const cpus = s.players - 1;
  return [
    `${s.players} players: you + ${cpus} CPU opponent${cpus === 1 ? '' : 's'}`,
    `CPU difficulty: ${DIFFICULTY_INFO[s.difficulty].label}`,
    `Game length: ${lengthLabel(s)}`,
    'Rules: publisher rule sheet, add-ons off',
  ];
}

const STORAGE_KEY = 'kombio.settings.v1';

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalizeSettings(raw ? JSON.parse(raw) : DEFAULT_SETTINGS);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: GameSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings simply aren't remembered */
  }
}
