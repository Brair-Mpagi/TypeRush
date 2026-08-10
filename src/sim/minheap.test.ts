import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MinHeap, topK } from './minheap';

describe('MinHeap', () => {
  it('pops keys in ascending order for any insertion order', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -1000, max: 1000 })), (keys) => {
        const heap = new MinHeap<number>();
        for (const k of keys) heap.push(k, k);
        const out: number[] = [];
        while (heap.size > 0) out.push(heap.pop()!);
        expect(out).toEqual([...keys].sort((a, b) => a - b));
      }),
    );
  });

  it('reports the smallest key without removing it', () => {
    const heap = new MinHeap<string>();
    heap.push(3, 'c');
    heap.push(1, 'a');
    heap.push(2, 'b');
    expect(heap.peekKey()).toBe(1);
    expect(heap.peek()).toBe('a');
    expect(heap.size).toBe(3);
  });

  it('returns undefined when empty and survives over-popping', () => {
    const heap = new MinHeap<number>();
    expect(heap.pop()).toBeUndefined();
    expect(heap.peekKey()).toBeUndefined();
    heap.push(1, 1);
    expect(heap.pop()).toBe(1);
    expect(heap.pop()).toBeUndefined();
  });

  it('handles interleaved pushes and pops', () => {
    const heap = new MinHeap<number>();
    heap.push(5, 5);
    heap.push(1, 1);
    expect(heap.pop()).toBe(1);
    heap.push(3, 3);
    heap.push(0, 0);
    expect(heap.pop()).toBe(0);
    expect(heap.pop()).toBe(3);
    expect(heap.pop()).toBe(5);
  });

  it('clears', () => {
    const heap = new MinHeap<number>();
    heap.push(1, 1);
    heap.clear();
    expect(heap.size).toBe(0);
  });
});

describe('topK', () => {
  it('matches a full sort for any k', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 100 }), { maxLength: 50 }),
        fc.integer({ min: 0, max: 10 }),
        (values, k) => {
          const expected = [...values].sort((a, b) => b - a).slice(0, k);
          expect(topK(values, k, (v) => v)).toEqual(expected);
        },
      ),
    );
  });

  it('returns nothing for k <= 0', () => {
    expect(topK([3, 1, 2], 0, (v) => v)).toEqual([]);
    expect(topK([3, 1, 2], -1, (v) => v)).toEqual([]);
  });

  it('returns everything when k exceeds the input size', () => {
    expect(topK([1, 2], 10, (v) => v)).toEqual([2, 1]);
  });
});
