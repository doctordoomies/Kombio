/** A source of uniformly distributed numbers in [0, 1). Inject one to make shuffling deterministic. */
export type Rng = () => number;

/**
 * One step of the mulberry32 PRNG. Pure: takes a 32-bit state, returns a value
 * and the next state. The game stores the state as plain data so a GameState
 * stays serializable (important for a future server-authoritative mode).
 */
export function mulberry32Next(state: number): { value: number; state: number } {
  const next = (state + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: next };
}

/** Convenience seeded RNG for tests and the AI. */
export function seededRng(seed: number): Rng {
  let state = seed | 0;
  return () => {
    const r = mulberry32Next(state);
    state = r.state;
    return r.value;
  };
}
