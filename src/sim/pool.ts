import type { WordEntity } from './types';

/**
 * Fixed-capacity object pool for word entities (§4).
 *
 * Words spawn and despawn constantly; allocating a fresh object each time
 * creates GC churn that shows up as frame-time jitter. Entities are recycled
 * instead: `acquire` reinitialises a slot, `release` marks it reusable.
 */
export class WordPool {
  private readonly slots: WordEntity[] = [];
  private readonly free: number[] = [];
  private readonly indexOf = new Map<string, number>();

  constructor(capacity: number) {
    for (let i = 0; i < capacity; i++) {
      this.slots.push({
        id: '',
        text: '',
        typedIndex: 0,
        x: 0,
        y: 0,
        speed: 0,
        spawnTime: 0,
        arrivalTime: 0,
        firstKeyTime: -1,
        correctKeys: 0,
        wrongKeys: 0,
        alive: false,
      });
      this.free.push(i);
    }
  }

  get capacity(): number {
    return this.slots.length;
  }

  get available(): number {
    return this.free.length;
  }

  acquire(init: Omit<WordEntity, 'alive'>): WordEntity | null {
    const slot = this.free.pop();
    if (slot === undefined) return null;
    const word = this.slots[slot]!;
    word.id = init.id;
    word.text = init.text;
    word.typedIndex = init.typedIndex;
    word.x = init.x;
    word.y = init.y;
    word.speed = init.speed;
    word.spawnTime = init.spawnTime;
    word.arrivalTime = init.arrivalTime;
    word.firstKeyTime = init.firstKeyTime;
    word.correctKeys = init.correctKeys;
    word.wrongKeys = init.wrongKeys;
    word.alive = true;
    this.indexOf.set(word.id, slot);
    return word;
  }

  release(word: WordEntity): void {
    const slot = this.indexOf.get(word.id);
    if (slot === undefined || !word.alive) return;
    word.alive = false;
    this.indexOf.delete(word.id);
    this.free.push(slot);
  }

  releaseAll(): void {
    for (let i = 0; i < this.slots.length; i++) {
      this.slots[i]!.alive = false;
    }
    this.indexOf.clear();
    this.free.length = 0;
    for (let i = 0; i < this.slots.length; i++) this.free.push(i);
  }
}
