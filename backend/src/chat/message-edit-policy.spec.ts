import {
  hasReachedEditLimit,
  isEditWindowOpen,
  MAX_EDITS_PER_MESSAGE,
  MESSAGE_EDIT_WINDOW_MS,
} from './message-edit-policy';

describe('message edit policy', () => {
  const sentAt = new Date('2026-10-05T12:00:00.000Z');
  const after = (ms: number) => new Date(sentAt.getTime() + ms);

  it('allows edits for 15 minutes after sending', () => {
    expect(MESSAGE_EDIT_WINDOW_MS).toBe(15 * 60 * 1000);
    expect(isEditWindowOpen(sentAt, after(0))).toBe(true);
    expect(isEditWindowOpen(sentAt, after(14 * 60 * 1000))).toBe(true);
  });

  it('includes the last moment of the window and not the next one', () => {
    expect(isEditWindowOpen(sentAt, after(MESSAGE_EDIT_WINDOW_MS))).toBe(true);
    expect(isEditWindowOpen(sentAt, after(MESSAGE_EDIT_WINDOW_MS + 1))).toBe(
      false,
    );
  });

  it('allows up to 10 edits per message', () => {
    expect(MAX_EDITS_PER_MESSAGE).toBe(10);
    expect(hasReachedEditLimit(0)).toBe(false);
    expect(hasReachedEditLimit(9)).toBe(false);
    expect(hasReachedEditLimit(10)).toBe(true);
    expect(hasReachedEditLimit(11)).toBe(true);
  });
});
