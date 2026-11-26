/**
 * Pure deterministic PRNG (FNV-1a seed hash + Mulberry32).
 * State is explicitly returned on every step so GameState owns RNG state
 * with zero hidden module globals.
 */

export function seedToUint32(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h === 0 ? 0x9e3779b9 : h;
}

export function nextRandom(rngState: number): { value: number; nextState: number } {
  const nextState = (rngState + 0x6d2b79f5) >>> 0;
  let t = nextState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, nextState };
}

export function deterministicShuffle<T>(
  items: readonly T[],
  rngState: number
): { shuffled: T[]; nextState: number } {
  const arr = [...items];
  let state = rngState;
  for (let i = arr.length - 1; i > 0; i--) {
    const step = nextRandom(state);
    state = step.nextState;
    const j = Math.floor(step.value * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return { shuffled: arr, nextState: state };
}
