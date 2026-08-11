import { describe, expect, it } from 'vitest';
import type { GameEvent, SessionState } from '../sim/types';
import { createContext, createSession, update } from '../sim/update';
import { SHIP_X, SHIP_Y, threatOf, Vfx } from './vfx';

/**
 * The VFX layer is presentation, but it is still a simulation of its own —
 * bullets that never expire or particles that never die would leak memory for
 * the whole run, and neither shows up in a screenshot.
 */

function emptyState(): SessionState {
  return createSession({ mode: 'arcade', level: 1, seed: 1 });
}

function tick(vfx: Vfx, state: SessionState, seconds: number, dt = 1 / 60): void {
  for (let t = 0; t < seconds; t += dt) vfx.update(dt, state, false);
}

describe('vfx', () => {
  it('fires a bullet from the ship for every correct keystroke', () => {
    const vfx = new Vfx();
    const event: GameEvent = { type: 'charTyped', wordId: 'w1', key: 'a', correct: true, charIndex: 0, x: 300, y: 120 };
    vfx.handleEvents([event]);

    expect(vfx.bullets).toHaveLength(1);
    expect(vfx.bullets[0]!.x).toBe(SHIP_X);
    expect(vfx.bullets[0]!.y).toBeLessThan(SHIP_Y);
    expect(vfx.muzzle).toBe(1);
  });

  it('sends a wrong keystroke wide of the target', () => {
    const vfx = new Vfx();
    vfx.handleEvents([{ type: 'charTyped', wordId: 'w1', key: 'z', correct: false, charIndex: 0, x: 300, y: 120 }]);
    expect(vfx.bullets[0]!.aimX).toBeGreaterThan(300);
    expect(vfx.shake).toBeGreaterThan(0);
  });

  it('explodes where the word died, not where the ship is', () => {
    const vfx = new Vfx();
    vfx.handleEvents([
      { type: 'wordCompleted', wordId: 'w1', text: 'ship', points: 10, combo: 1, x: 220, y: 340 },
    ]);
    expect(vfx.particles.length).toBeGreaterThan(0);
    for (const p of vfx.particles) {
      expect(p.x).toBeCloseTo(220, 0);
      expect(p.y).toBeCloseTo(340, 0);
    }
  });

  it('lands a miss on the ship and flashes damage', () => {
    const vfx = new Vfx();
    vfx.handleEvents([{ type: 'wordMissed', wordId: 'w1', text: 'ship', x: 220, y: 660 }]);
    expect(vfx.damageFlash).toBe(1);
    expect(vfx.shake).toBeGreaterThan(10);
    expect(vfx.particles[0]!.x).toBeCloseTo(SHIP_X, 0);
  });

  it('retires bullets and particles instead of accumulating them', () => {
    const vfx = new Vfx();
    const state = emptyState();
    for (let i = 0; i < 50; i++) {
      vfx.handleEvents([
        { type: 'charTyped', wordId: 'gone', key: 'a', correct: true, charIndex: i, x: 100 + i, y: 200 },
        { type: 'wordCompleted', wordId: 'gone', text: 'word', points: 1, combo: 1, x: 400, y: 200 },
      ]);
    }
    tick(vfx, state, 3);

    expect(vfx.bullets).toHaveLength(0);
    expect(vfx.particles).toHaveLength(0);
  });

  it('caps particle count however many words die at once', () => {
    const vfx = new Vfx();
    for (let i = 0; i < 200; i++) {
      vfx.handleEvents([{ type: 'gameOver', score: 100 }]);
    }
    expect(vfx.particles.length).toBeLessThanOrEqual(400);
  });

  it('decays shake and flash back to exactly zero', () => {
    const vfx = new Vfx();
    const state = emptyState();
    vfx.handleEvents([{ type: 'wordMissed', wordId: 'w1', text: 'hit', x: 500, y: 660 }]);
    tick(vfx, state, 5);

    expect(vfx.shake).toBe(0);
    expect(vfx.damageFlash).toBe(0);
    expect(vfx.muzzle).toBe(0);
  });

  it('tracks bullets onto a word that is still moving', () => {
    const ctx = createContext();
    const state = createSession({ mode: 'arcade', level: 3, seed: 7 });
    const vfx = new Vfx();
    for (let i = 0; i < 240 && state.activeWords.length === 0; i++) update(ctx, state, 1 / 60, []);
    const word = state.activeWords[0]!;

    vfx.handleEvents([
      { type: 'charTyped', wordId: word.id, key: word.text[0]!, correct: true, charIndex: 0, x: word.x, y: word.y },
    ]);
    const firstAim = vfx.bullets[0]!.aimY;
    update(ctx, state, 0.2, []);
    vfx.update(1 / 60, state, false);

    // The word fell; the shot followed it down rather than aiming at stale air.
    expect(vfx.bullets[0]!.aimY).toBeGreaterThan(firstAim);
  });

  it('keeps the ship aimed at the locked target', () => {
    const ctx = createContext();
    const state = createSession({ mode: 'arcade', level: 3, seed: 11 });
    const vfx = new Vfx();
    for (let i = 0; i < 240 && state.activeWords.length === 0; i++) update(ctx, state, 1 / 60, []);
    const word = state.activeWords[0]!;
    state.lockedWordId = word.id;

    word.x = 50;
    vfx.update(1 / 60, state, false);
    const leftAim = vfx.aim;
    word.x = 900;
    vfx.update(1 / 60, state, false);

    expect(leftAim).toBeLessThan(0);
    expect(vfx.aim).toBeGreaterThan(0);
  });

  it('holds the starfield still under reduced motion', () => {
    const vfx = new Vfx();
    const state = emptyState();
    const before = vfx.stars.map((s) => s.y);
    tick(vfx, state, 1);
    expect(vfx.stars.map((s) => s.y)).toEqual(before.map((_, i) => vfx.stars[i]!.y));

    const still = new Vfx();
    const snapshot = still.stars.map((s) => s.y);
    for (let i = 0; i < 60; i++) still.update(1 / 60, state, true);
    expect(still.stars.map((s) => s.y)).toEqual(snapshot);
  });

  it('wraps stars back to the top of the world', () => {
    const vfx = new Vfx();
    const state = emptyState();
    tick(vfx, state, 30);
    for (const star of vfx.stars) {
      expect(star.y).toBeGreaterThanOrEqual(0);
      expect(star.y).toBeLessThanOrEqual(700);
    }
  });

  it('reports threat as a 0–1 ramp toward the ship', () => {
    expect(threatOf(0)).toBe(0);
    expect(threatOf(-50)).toBe(0);
    expect(threatOf(9999)).toBe(1);
    expect(threatOf(330)).toBeCloseTo(0.5, 1);
  });

  it('clears every transient effect on reset', () => {
    const vfx = new Vfx();
    vfx.handleEvents([
      { type: 'charTyped', wordId: 'w', key: 'a', correct: true, charIndex: 0, x: 10, y: 10 },
      { type: 'wordMissed', wordId: 'w', text: 'a', x: 10, y: 660 },
    ]);
    vfx.reset();

    expect(vfx.bullets).toHaveLength(0);
    expect(vfx.particles).toHaveLength(0);
    expect(vfx.shake).toBe(0);
    expect(vfx.damageFlash).toBe(0);
    // The starfield survives: it is scenery, not a transient effect.
    expect(vfx.stars.length).toBeGreaterThan(0);
  });
});
