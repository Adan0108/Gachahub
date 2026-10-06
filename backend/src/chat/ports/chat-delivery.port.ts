import type { ChatMessageMedia } from '../../generated/prisma/client';

export const CHAT_DELIVERY_PORT = Symbol('CHAT_DELIVERY_PORT');

/**
 * Event emitted after a chat message is persisted.
 *
 * shouldNotify only gates client notification/badge behavior, never delivery.
 */
export interface ChatMessageCreatedEvent {
  conversationId: string;
  messageId: string;
  senderId: string;
  recipientUserIds: string[];
  shouldNotify: boolean;
  ciphertext: string;
  encryptionMeta: unknown;
  contentType: string;
  createdAt: Date;
  clientMessageId: string | null;
  replyToId: string | null;
  media: ChatMessageMedia[];
}

/**
 * Shared shape for edit/delete/reaction events.
 *
 * All four carry the same fields; only the port method (and the socket event
 * name it emits) says what actually happened.
 */
export interface ChatMessageActionEvent {
  conversationId: string;
  messageId: string;
  actorId: string;
  recipientUserIds: string[];
}

/**
 * Event emitted after a pending message request is accepted.
 *
 * Lets the request's original sender(s) know right away, instead of only
 * finding out on the next unrelated refetch.
 */
export interface ChatRequestAcceptedEvent {
  conversationId: string;
  userId: string;
  recipientUserIds: string[];
}

/**
 * Someone's device received (`delivered`) or someone read up to a message (`read`), for the
 * people who sent those messages. A read also counts as delivered for everything up to it.
 */
export type ChatReceiptsUpdatedEvent = {
  conversationId: string;
  readerId: string;
  recipientUserIds: string[];
} & (
  | { kind: 'delivered'; messageIds: string[] }
  | { kind: 'read'; upToMessageId: string; at: Date }
);

/**
 * Port for chat delivery side effects.
 *
 * REST persistence works without this doing anything today. Later, a WebSocket,
 * Redis pub/sub, cloud queue, or push-notification adapter can implement the
 * same interface without changing ChatService.
 */
export interface ChatDeliveryPort {
  publishMessageCreated(event: ChatMessageCreatedEvent): Promise<void>;
  publishMessageEdited(event: ChatMessageActionEvent): Promise<void>;
  publishMessageDeleted(event: ChatMessageActionEvent): Promise<void>;
  publishReactionAdded(event: ChatMessageActionEvent): Promise<void>;
  publishReactionRemoved(event: ChatMessageActionEvent): Promise<void>;
  publishRequestAccepted(event: ChatRequestAcceptedEvent): Promise<void>;
  publishReceiptsUpdated(event: ChatReceiptsUpdatedEvent): Promise<void>;
}
