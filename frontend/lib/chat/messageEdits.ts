import { isEditEnvelope } from '../mls/messaging/editEnvelope';
import { envelopeView } from '../mls/media/attachmentView';
import type { PlaintextEnvelope } from '../mls/contract/types';
import { isEditWindowOpen, MAX_EDITS_PER_MESSAGE } from './editPolicy';

export interface EditableMessage {
  id: string;
  senderId: string;
  createdAt: string;
  status?: string;
  contentType?: string;
  /** Set by the server on a hidden edit: the message it is a new version of. */
  editsMessageId?: string | null;
}

type DecryptState = { status: 'pending' } | { status: 'ok'; envelope: PlaintextEnvelope } | { status: 'unavailable' };

/** One version of a message's text; the first is what it said when sent (null when this device never read it). */
export interface MessageVersion {
  text: string | null;
  /** When this version was sent, epoch ms. */
  at: number;
}

export interface EditedMessage {
  /** Oldest first; the last is what the message says now. */
  versions: MessageVersion[];
}

export interface AppliedEdits {
  /** Like the input, but an edited message holds its latest text. */
  decrypted: Record<string, DecryptState>;
  edited: Map<string, EditedMessage>;
}

/** Whether a message is a hidden edit of another one rather than something to show. */
export const isEditMessage = (message: { contentType?: string }) => message.contentType === 'EDIT';

/**
 * Applies the hidden edit messages in `messages` to the messages they edit. An edit counts only if
 * it was sent by the same person as the original, the server says it is an edit of that message,
 * it came inside the edit window, and it is within the edit limit; anything else is ignored.
 */
export function applyEdits(messages: EditableMessage[], decrypted: Record<string, DecryptState>): AppliedEdits {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const editsByTarget = new Map<string, { message: EditableMessage; text: string }[]>();

  for (const message of messages) {
    if (!isEditMessage(message) || message.status === 'DELETED') continue;
    const state = decrypted[message.id];
    if (state?.status !== 'ok' || !isEditEnvelope(state.envelope)) continue;

    const { targetMessageId, text } = state.envelope.body;
    const target = byId.get(targetMessageId);
    if (!target || message.editsMessageId !== targetMessageId) continue;
    if (target.senderId !== message.senderId || target.status === 'DELETED') continue;
    if (target.contentType !== 'TEXT' && target.contentType !== undefined) continue;
    if (!isEditWindowOpen(Date.parse(target.createdAt), Date.parse(message.createdAt))) continue;

    const list = editsByTarget.get(targetMessageId) ?? [];
    list.push({ message, text });
    editsByTarget.set(targetMessageId, list);
  }

  const result: Record<string, DecryptState> = { ...decrypted };
  const edited = new Map<string, EditedMessage>();

  for (const [targetId, found] of editsByTarget) {
    const target = byId.get(targetId)!;
    const accepted = found
      .sort((a, b) => Date.parse(a.message.createdAt) - Date.parse(b.message.createdAt) || a.message.id.localeCompare(b.message.id))
      .slice(0, MAX_EDITS_PER_MESSAGE);

    const originalState = decrypted[targetId];
    const originalView = originalState?.status === 'ok' ? envelopeView(originalState.envelope) : null;
    edited.set(targetId, {
      versions: [
        { text: originalView?.kind === 'text' ? originalView.text : null, at: Date.parse(target.createdAt) },
        ...accepted.map(({ message, text }) => ({ text, at: Date.parse(message.createdAt) })),
      ],
    });
    // The card stays with the message; whether it still shows is decided against the new text when it is drawn
    const previews = originalState?.status === 'ok' ? (originalState.envelope as { previews?: unknown }).previews : undefined;
    result[targetId] = {
      status: 'ok',
      envelope: {
        v: 1,
        type: 'text',
        body: accepted[accepted.length - 1]!.text,
        ...(previews ? { previews } : {}),
      } as PlaintextEnvelope,
    };
  }

  return { decrypted: result, edited };
}
