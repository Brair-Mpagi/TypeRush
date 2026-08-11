import { topK } from './minheap';
import type { Keystroke } from './types';

/**
 * Typing metrics (§9) — every one is a pure fold over the append-only
 * keystroke log, never a mutable counter maintained inside the update loop.
 * That is what keeps WPM/accuracy from drifting out of sync with reality.
 */

export interface SessionMetrics {
  wpm: number;
  rawWpm: number;
  accuracy: number;
  errorRate: number;
  consistency: number;
  correctChars: number;
  totalChars: number;
  errors: number;
  durationMs: number;
}

export function countCorrect(keystrokes: readonly Keystroke[]): number {
  let n = 0;
  for (const k of keystrokes) if (k.correct) n++;
  return n;
}

/** Standard WPM: 5 correct chars = 1 word, normalised to a minute. */
export function wpm(correctChars: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  return correctChars / 5 / (elapsedMs / 60000);
}

export function accuracy(keystrokes: readonly Keystroke[]): number {
  if (keystrokes.length === 0) return 1;
  return countCorrect(keystrokes) / keystrokes.length;
}

export function errorRate(keystrokes: readonly Keystroke[]): number {
  if (keystrokes.length === 0) return 0;
  return 1 - accuracy(keystrokes);
}

/**
 * Consistency as 1 − coefficient of variation of inter-keystroke intervals.
 * Steadier rhythm → closer to 1. Clamped to [0, 1] so a single huge pause
 * can't produce a negative "score".
 *
 * Only intervals *within* a word count. The gap between finishing one word and
 * starting the next is time spent waiting for a target to spawn and descend —
 * it is a property of the difficulty curve, not of the typist, and it is large
 * enough to swamp the real rhythm: including it floored this metric at 0 for
 * essentially every session.
 */
export function consistency(keystrokes: readonly Keystroke[]): number {
  if (keystrokes.length < 3) return 1;
  const intervals: number[] = [];
  for (let i = 1; i < keystrokes.length; i++) {
    const previous = keystrokes[i - 1]!;
    const current = keystrokes[i]!;
    if (current.wordId !== previous.wordId) continue;
    const dt = current.timestamp - previous.timestamp;
    if (dt > 0) intervals.push(dt);
  }
  if (intervals.length < 2) return 1;
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  if (mean <= 0) return 1;
  const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
  return Math.max(0, Math.min(1, 1 - Math.sqrt(variance) / mean));
}

export function computeMetrics(keystrokes: readonly Keystroke[], elapsedMs: number): SessionMetrics {
  const correctChars = countCorrect(keystrokes);
  const totalChars = keystrokes.length;
  return {
    wpm: wpm(correctChars, elapsedMs),
    rawWpm: wpm(totalChars, elapsedMs),
    accuracy: accuracy(keystrokes),
    errorRate: errorRate(keystrokes),
    consistency: consistency(keystrokes),
    correctChars,
    totalChars,
    errors: totalChars - correctChars,
    durationMs: elapsedMs,
  };
}

/* ------------------------------------------------------------------ */
/* Weak-key analysis (§10)                                             */
/* ------------------------------------------------------------------ */

export interface KeyStat {
  char: string;
  attempts: number;
  errors: number;
}

/** O(1) amortised per keystroke; keyed on the *expected* char, not the pressed one. */
export function buildErrorMap(keystrokes: readonly Keystroke[]): Map<string, KeyStat> {
  const map = new Map<string, KeyStat>();
  for (const k of keystrokes) {
    if (!k.expected) continue;
    let stat = map.get(k.expected);
    if (!stat) {
      stat = { char: k.expected, attempts: 0, errors: 0 };
      map.set(k.expected, stat);
    }
    stat.attempts++;
    if (!k.correct) stat.errors++;
  }
  return map;
}

/** Minimum attempts before a key is considered statistically meaningful. */
export const MIN_ATTEMPTS_FOR_WEAKNESS = 4;

export function keyErrorRate(stat: KeyStat): number {
  return stat.attempts === 0 ? 0 : stat.errors / stat.attempts;
}

/**
 * Top-k problem keys via a size-k min-heap: O(n log k) rather than sorting the
 * whole map at O(n log n), which matters once a long history spans 40+ keys.
 */
export function weakestKeys(stats: Iterable<KeyStat>, k = 5): KeyStat[] {
  const eligible: KeyStat[] = [];
  for (const s of stats) {
    if (s.attempts >= MIN_ATTEMPTS_FOR_WEAKNESS && s.errors > 0) eligible.push(s);
  }
  return topK(eligible, k, keyErrorRate);
}
