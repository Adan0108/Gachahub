import { Injectable } from '@nestjs/common';
import { chatUserRoom } from './chat-socket.util';
import { ChatSocketRegistry } from './chat-socket-registry.service';
import {
  ChatDeliveryPort,
  ChatMessageCreatedEvent,
} from './ports/chat-delivery.port';

// real ChatDeliveryPort now, was noop before, ChatService untouched either way
@Injectable()
export class SocketChatDeliveryService implements ChatDeliveryPort {
  constructor(private readonly socketRegistry: ChatSocketRegistry) {}

  publishMessageCreated(event: ChatMessageCreatedEvent): Promise<void> {
    // recipientUserIds stay out, it leaks who else got this batch; shouldNotify is
    // safe, each recipient only ever gets one call, so it's about them, not others.
    const payload = {
      conversationId: event.conversationId,
      messageId: event.messageId,
      senderId: event.senderId,
      shouldNotify: event.shouldNotify,
    };

    // offline recipient just doesnt get it, no queue no retry, REST covers that case
    for (const recipientUserId of event.recipientUserIds) {
      this.socketRegistry.server
        ?.to(chatUserRoom(recipientUserId))
        .emit('message:created', payload);
    }

    return Promise.resolve(); // nothing to await, just satisfy the interface
  }
}
