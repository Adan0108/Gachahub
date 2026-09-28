import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getHiddenMessageIds, hideMessageForMe } from './chatHiddenMessages';

function fakeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  };
}

beforeEach(() => {
  vi.stubGlobal('window', { localStorage: fakeLocalStorage() });
});

afterEach(() => vi.unstubAllGlobals());

describe('chatHiddenMessages', () => {
  it('has nothing hidden for a conversation until something is hidden', () => {
    expect(getHiddenMessageIds('c1')).toEqual(new Set());
  });

  it('remembers a hidden message, scoped to its own conversation', () => {
    hideMessageForMe('c1', 'm1');
    expect(getHiddenMessageIds('c1')).toEqual(new Set(['m1']));
    expect(getHiddenMessageIds('c2')).toEqual(new Set());
  });

  it('accumulates more than one hidden message', () => {
    hideMessageForMe('c1', 'm1');
    hideMessageForMe('c1', 'm2');
    expect(getHiddenMessageIds('c1')).toEqual(new Set(['m1', 'm2']));
  });
});
