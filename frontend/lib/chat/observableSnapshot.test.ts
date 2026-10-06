import { describe, expect, it, vi } from 'vitest';
import { ObservableSnapshot } from './observableSnapshot';

describe('ObservableSnapshot', () => {
  it('hands out the current snapshot, the same object until it is replaced', () => {
    const state = new ObservableSnapshot({ count: 0 });

    expect(state.getSnapshot()).toBe(state.getSnapshot());
  });

  it('replaces the snapshot and tells every listener', () => {
    const state = new ObservableSnapshot({ count: 0 });
    const first = vi.fn();
    const second = vi.fn();
    state.subscribe(first);
    state.subscribe(second);

    state.set({ count: 1 });

    expect(state.getSnapshot()).toEqual({ count: 1 });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops telling a listener once it unsubscribes', () => {
    const state = new ObservableSnapshot(0);
    const listener = vi.fn();
    const stop = state.subscribe(listener);

    stop();
    state.set(1);

    expect(listener).not.toHaveBeenCalled();
  });

  it('can be used detached, as useSyncExternalStore does', () => {
    const state = new ObservableSnapshot(0);
    const { subscribe, getSnapshot } = state;
    const listener = vi.fn();
    subscribe(listener);

    state.set(5);

    expect(getSnapshot()).toBe(5);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
