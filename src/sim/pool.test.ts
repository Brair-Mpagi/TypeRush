import { describe, expect, it } from 'vitest';
import { WordPool } from './pool';
import type { WordEntity } from './types';

function init(id: string): Omit<WordEntity, 'alive'> {
  return {
    id,
    text: 'test',
    typedIndex: 0,
    x: 10,
    y: 0,
    speed: 100,
    spawnTime: 0,
    arrivalTime: 6,
    firstKeyTime: -1,
    correctKeys: 0,
    wrongKeys: 0,
  };
}

describe('WordPool', () => {
  it('recycles slots instead of allocating new objects', () => {
    const pool = new WordPool(2);
    const a = pool.acquire(init('a'))!;
    pool.release(a);
    const b = pool.acquire(init('b'))!;
    expect(b).toBe(a); // same underlying object, reinitialised
    expect(b.id).toBe('b');
    expect(b.alive).toBe(true);
  });

  it('returns null when exhausted rather than growing', () => {
    const pool = new WordPool(1);
    expect(pool.acquire(init('a'))).not.toBeNull();
    expect(pool.acquire(init('b'))).toBeNull();
    expect(pool.available).toBe(0);
  });

  it('resets every field on acquire', () => {
    const pool = new WordPool(1);
    const a = pool.acquire(init('a'))!;
    a.typedIndex = 3;
    a.y = 500;
    a.correctKeys = 3;
    pool.release(a);
    const b = pool.acquire(init('b'))!;
    expect(b.typedIndex).toBe(0);
    expect(b.y).toBe(0);
    expect(b.correctKeys).toBe(0);
  });

  it('ignores a double release', () => {
    const pool = new WordPool(2);
    const a = pool.acquire(init('a'))!;
    pool.release(a);
    pool.release(a);
    expect(pool.available).toBe(2);
  });

  it('releases everything at once on reset', () => {
    const pool = new WordPool(3);
    const words = [pool.acquire(init('a'))!, pool.acquire(init('b'))!];
    pool.releaseAll();
    expect(pool.available).toBe(3);
    expect(words.every((w) => !w.alive)).toBe(true);
  });
});
