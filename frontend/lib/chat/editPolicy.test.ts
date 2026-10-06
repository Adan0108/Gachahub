import { describe, expect, it } from 'vitest';
import { canEditMessage, isEditWindowOpen, MAX_EDITS_PER_MESSAGE, MESSAGE_EDIT_WINDOW_MS } from './editPolicy';

describe('edit policy', () => {
  it('matches the backend: 15 minutes and 10 edits', () => {
    expect(MESSAGE_EDIT_WINDOW_MS).toBe(15 * 60 * 1000);
    expect(MAX_EDITS_PER_MESSAGE).toBe(10);
  });

  it('keeps the window open through its last moment', () => {
    expect(isEditWindowOpen(1000, 1000)).toBe(true);
    expect(isEditWindowOpen(1000, 1000 + MESSAGE_EDIT_WINDOW_MS)).toBe(true);
    expect(isEditWindowOpen(1000, 1000 + MESSAGE_EDIT_WINDOW_MS + 1)).toBe(false);
  });

  describe('canEditMessage', () => {
    const ok = { mine: true, isText: true, sentAt: 0, now: 60_000, editCount: 0 };

    it('allows your own recent text message', () => {
      expect(canEditMessage(ok)).toBe(true);
      expect(canEditMessage({ ...ok, editCount: 9 })).toBe(true);
    });

    it.each([
      ['someone else', { mine: false }],
      ['something that is not text', { isText: false }],
      ['too late', { now: MESSAGE_EDIT_WINDOW_MS + 1 }],
      ['already edited 10 times', { editCount: 10 }],
      ['a message with no valid time', { sentAt: Number.NaN }],
    ])('refuses %s', (_name, overrides) => {
      expect(canEditMessage({ ...ok, ...overrides })).toBe(false);
    });
  });
});
