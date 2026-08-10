/**
 * Binary min-heap keyed by a numeric priority (§8, §10).
 *
 * Used twice: arrival-time ordering for miss detection, and a bounded
 * size-k heap for top-k weak-key extraction.
 */
export class MinHeap<T> {
  private items: { key: number; value: T }[] = [];

  get size(): number {
    return this.items.length;
  }

  push(key: number, value: T): void {
    this.items.push({ key, value });
    this.siftUp(this.items.length - 1);
  }

  peekKey(): number | undefined {
    return this.items[0]?.key;
  }

  peek(): T | undefined {
    return this.items[0]?.value;
  }

  pop(): T | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0]!;
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.siftDown(0);
    }
    return top.value;
  }

  clear(): void {
    this.items.length = 0;
  }

  /** Snapshot of the heap contents in unspecified order — for tests/debugging. */
  toArray(): { key: number; value: T }[] {
    return this.items.slice();
  }

  private siftUp(i: number): void {
    const items = this.items;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent]!.key <= items[i]!.key) break;
      [items[parent], items[i]] = [items[i]!, items[parent]!];
      i = parent;
    }
  }

  private siftDown(i: number): void {
    const items = this.items;
    const n = items.length;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;
      if (left < n && items[left]!.key < items[smallest]!.key) smallest = left;
      if (right < n && items[right]!.key < items[smallest]!.key) smallest = right;
      if (smallest === i) break;
      [items[smallest], items[i]] = [items[i]!, items[smallest]!];
      i = smallest;
    }
  }
}

/**
 * Keeps the k largest items by score using a size-k min-heap:
 * O(n log k) instead of sorting the whole collection at O(n log n).
 */
export function topK<T>(items: Iterable<T>, k: number, score: (item: T) => number): T[] {
  if (k <= 0) return [];
  const heap = new MinHeap<T>();
  for (const item of items) {
    const s = score(item);
    if (heap.size < k) {
      heap.push(s, item);
    } else if (s > heap.peekKey()!) {
      heap.pop();
      heap.push(s, item);
    }
  }
  const out: T[] = [];
  while (heap.size > 0) out.push(heap.pop()!);
  return out.reverse();
}
