export const CHAT_DELIVERY_PORT = Symbol('CHAT_DELIVERY_PORT');

/**
 * Event emitted after a chat message is persisted.
 *
 * shouldNotify lets delivery adapters distinguish normal inbox messages from
 * pending stranger requests, which should sync but not notify.
 */
export interface ChatMessageCreatedEvent {
  conversationId: string;
  messageId: string;
  senderId: string;
  recipientUserIds: string[];
  shouldNotify: boolean;
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
}
