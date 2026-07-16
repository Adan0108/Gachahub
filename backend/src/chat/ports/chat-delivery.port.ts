export const CHAT_DELIVERY_PORT = Symbol('CHAT_DELIVERY_PORT');

export interface ChatMessageCreatedEvent {
  conversationId: string;
  messageId: string;
  senderId: string;
  recipientUserIds: string[];
  shouldNotify: boolean;
}

export interface ChatDeliveryPort {
  publishMessageCreated(event: ChatMessageCreatedEvent): Promise<void>;
}
