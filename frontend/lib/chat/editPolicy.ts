/** How long after sending a message its author can still edit it (the backend enforces the same). */
export const MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000;

/** How many times one message can be edited. */
export const MAX_EDITS_PER_MESSAGE = 10;

/** Whether a message sent at `sentAt` (epoch ms) can still be edited at `now`. */
export function isEditWindowOpen(sentAt: number, now: number): boolean {
  return now - sentAt <= MESSAGE_EDIT_WINDOW_MS;
}

/** Whether you can start an edit of a message now: yours, text, readable, in time, and under the edit limit. */
export function canEditMessage(input: {
  mine: boolean;
  isText: boolean;
  sentAt: number;
  now: number;
  editCount: number;
}): boolean {
  return (
    input.mine &&
    input.isText &&
    !Number.isNaN(input.sentAt) &&
    isEditWindowOpen(input.sentAt, input.now) &&
    input.editCount < MAX_EDITS_PER_MESSAGE
  );
}
