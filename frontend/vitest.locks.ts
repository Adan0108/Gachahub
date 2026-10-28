/** jsdom has no Web Locks: this gives its tests an in-process lock with the same exclusive, first-come order. */
export function installTestWebLocks(): void {
  if (typeof navigator !== 'undefined' && navigator.locks) return;

  const tails = new Map<string, Promise<unknown>>();
  const request = (name: string, _options: unknown, task: () => Promise<unknown>) => {
    const run = (tails.get(name) ?? Promise.resolve()).then(task, task);
    tails.set(
      name,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  };

  const target = globalThis as { navigator?: object };
  if (!target.navigator) {
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
  }
  Object.defineProperty(globalThis.navigator, 'locks', { value: { request }, configurable: true });
}
