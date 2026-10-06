/** How long after sending a message its author can still edit it. */
export const MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000;

/** How many times one message can be edited. */
export const MAX_EDITS_PER_MESSAGE = 10;

/** Whether a message sent at `sentAt` can still be edited at `now`. */
export function isEditWindowOpen(sentAt: Date, now = new Date()): boolean {
  return now.getTime() - sentAt.getTime() <= MESSAGE_EDIT_WINDOW_MS;
}

/** Whether a message that has already been edited `editCount` times can take no more edits. */
export function hasReachedEditLimit(editCount: number): boolean {
  return editCount >= MAX_EDITS_PER_MESSAGE;
}
