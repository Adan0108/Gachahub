import { describe, expect, it, vi } from 'vitest';
import { typingSignal } from './chatTypingSignal';

describe('typingSignal', () => {
  it('notifies subscribers with the conversation id and active state', () => {
    const listener = vi.fn();
    const unsubscribe = typingSignal.subscribe(listener);

    typingSignal.ping('c1');
    typingSignal.stop('c1');
    unsubscribe();

    expect(listener.mock.calls).toEqual([
      ['c1', true],
      ['c1', false],
    ]);
  });

  it('stops notifying once unsubscribed', () => {
    const listener = vi.fn();
    const unsubscribe = typingSignal.subscribe(listener);
    unsubscribe();

    typingSignal.ping('c1');

    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies every current subscriber independently', () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubscribeA = typingSignal.subscribe(a);
    const unsubscribeB = typingSignal.subscribe(b);

    typingSignal.ping('c1');

    expect(a).toHaveBeenCalledWith('c1', true);
    expect(b).toHaveBeenCalledWith('c1', true);
    unsubscribeA();
    unsubscribeB();
  });
});
