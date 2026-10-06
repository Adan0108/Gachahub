import type { EditEnvelope } from '../contract/types';

/** Longest text an edit can carry. */
export const MAX_EDIT_TEXT_CHARS = 4000;
const MAX_MESSAGE_ID_CHARS = 120;
const MAX_EDIT_NUMBER = 10;

export function buildEditEnvelope(edit: { targetMessageId: string; text: string; n: number }): EditEnvelope {
  return { v: 1, type: 'edit', body: edit };
}

/** Structural check for a decrypted `edit` envelope - the sender is a peer, so nothing here is trusted. */
export function isEditEnvelope(value: unknown): value is EditEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const { v, type, body } = value as { v?: unknown; type?: unknown; body?: unknown };
  if (v !== 1 || type !== 'edit' || typeof body !== 'object' || body === null) return false;

  const { targetMessageId, text, n } = body as { targetMessageId?: unknown; text?: unknown; n?: unknown };
  return (
    typeof targetMessageId === 'string' &&
    targetMessageId.length > 0 &&
    targetMessageId.length <= MAX_MESSAGE_ID_CHARS &&
    typeof text === 'string' &&
    text.trim().length > 0 &&
    text.length <= MAX_EDIT_TEXT_CHARS &&
    Number.isInteger(n) &&
    (n as number) >= 1 &&
    (n as number) <= MAX_EDIT_NUMBER
  );
}
