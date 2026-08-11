import { useSyncExternalStore } from 'react';

/**
 * A ~30-line pub/sub store (§16).
 *
 * React subscribes to this for chrome — score, lives, results. The game loop
 * pushes into it; it never drives the loop. Frame timing must not depend on
 * React's scheduler.
 */
export class Store<T> {
  private listeners = new Set<() => void>();

  constructor(private value: T) {}

  get(): T {
    return this.value;
  }

  set(next: T): void {
    if (Object.is(next, this.value)) return;
    this.value = next;
    for (const listener of this.listeners) listener();
  }

  update(fn: (current: T) => T): void {
    this.set(fn(this.value));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, () => store.get(), () => store.get());
}
