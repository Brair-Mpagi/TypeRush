import { describe, expect, it } from 'vitest';
import { ALL_FSM_STATES, canTransition, transition, transitions } from './fsm';

describe('game FSM', () => {
  it('allows exactly the transitions in the table', () => {
    for (const from of ALL_FSM_STATES) {
      for (const to of ALL_FSM_STATES) {
        expect(canTransition(from, to)).toBe(transitions[from].includes(to));
      }
    }
  });

  it('throws on an illegal transition', () => {
    expect(() => transition('menu', 'playing')).toThrow(/Illegal FSM transition/);
    expect(() => transition('gameOver', 'playing')).toThrow();
  });

  it('returns the target state for a legal transition', () => {
    expect(transition('menu', 'levelSelect')).toBe('levelSelect');
    expect(transition('playing', 'paused')).toBe('paused');
    expect(transition('paused', 'playing')).toBe('playing');
  });

  it('has no state that is unreachable from the menu', () => {
    const seen = new Set(['menu']);
    const queue = ['menu' as const];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of transitions[current]) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next as 'menu');
        }
      }
    }
    expect([...seen].sort()).toEqual([...ALL_FSM_STATES].sort());
  });

  it('never strands the player: every state can get back to the menu', () => {
    for (const start of ALL_FSM_STATES) {
      const seen = new Set([start]);
      const queue = [start];
      let reachesMenu = false;
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (current === 'menu') reachesMenu = true;
        for (const next of transitions[current]) {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      expect(reachesMenu, `${start} cannot reach menu`).toBe(true);
    }
  });
});
