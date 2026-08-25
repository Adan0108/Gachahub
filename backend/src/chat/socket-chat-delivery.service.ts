import { Injectable } from '@nestjs/common';
import { chatUserRoom } from './chat-socket.util';
import { ChatGateway } from './chat.gateway';
import {
  ChatDeliveryPort,
  ChatMessageCreatedEvent,
} from './ports/chat-delivery.port';

// real ChatDeliveryPort now, was noop before, ChatService untouched either way
@Injectable()
export class SocketChatDeliveryService implements ChatDeliveryPort {
  constructor(private readonly chatGateway: ChatGateway) {}

  publishMessageCreated(event: ChatMessageCreatedEvent): Promise<void> {
    // offline recipient just doesnt get it, no queue no retry, REST covers that case
    for (const recipientUserId of event.recipientUserIds) {
      this.chatGateway.server
        .to(chatUserRoom(recipientUserId))
        .emit('message:created', event);
    }

    return Promise.resolve(); // nothing to await, just satisfy the interface
  }
}
