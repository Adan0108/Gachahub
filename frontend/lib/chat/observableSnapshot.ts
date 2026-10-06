/** A value React can subscribe to with useSyncExternalStore: subscribe, read the current snapshot, replace it. */
export class ObservableSnapshot<T> {
  private readonly listeners = new Set<() => void>();

  constructor(private snapshot: T) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): T => this.snapshot;

  /** Replaces the snapshot with a new object and tells every listener. */
  set(next: T): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
