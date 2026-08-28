import { Injectable } from '@nestjs/common';
import { chatUserRoom } from './chat-socket.util';
import { ChatSocketRegistry } from './chat-socket-registry.service';
import {
  ChatDeliveryPort,
  ChatMessageCreatedEvent,
  ChatMessageActionEvent,
} from './ports/chat-delivery.port';

type ChatSocketEventName =
  | 'message:created'
  | 'message:edited'
  | 'message:deleted'
  | 'reaction:added'
  | 'reaction:removed';

// real ChatDeliveryPort now, was noop before, ChatService untouched either way
@Injectable()
export class SocketChatDeliveryService implements ChatDeliveryPort {
  constructor(private readonly socketRegistry: ChatSocketRegistry) {}

  publishMessageCreated(event: ChatMessageCreatedEvent): Promise<void> {
    // recipientUserIds stay out, it leaks who else got this batch; shouldNotify is
    // safe, each recipient only ever gets one call, so it's about them, not others.
    return this.emitToRecipients('message:created', event.recipientUserIds, {
      conversationId: event.conversationId,
      messageId: event.messageId,
      senderId: event.senderId,
      shouldNotify: event.shouldNotify,
    });
  }

  publishMessageEdited(event: ChatMessageActionEvent): Promise<void> {
    return this.emitActionEvent('message:edited', event);
  }

  publishMessageDeleted(event: ChatMessageActionEvent): Promise<void> {
    return this.emitActionEvent('message:deleted', event);
  }

  publishReactionAdded(event: ChatMessageActionEvent): Promise<void> {
    return this.emitActionEvent('reaction:added', event);
  }

  publishReactionRemoved(event: ChatMessageActionEvent): Promise<void> {
    return this.emitActionEvent('reaction:removed', event);
  }

  // shared by edit/delete/reaction events, only the event name and actorId differ
  private emitActionEvent(
    eventName: ChatSocketEventName,
    event: ChatMessageActionEvent,
  ): Promise<void> {
    return this.emitToRecipients(eventName, event.recipientUserIds, {
      conversationId: event.conversationId,
      messageId: event.messageId,
      actorId: event.actorId,
    });
  }

  // offline recipient just doesnt get it, no queue no retry, REST covers that case
  private emitToRecipients(
    eventName: ChatSocketEventName,
    recipientUserIds: string[],
    payload: unknown,
  ): Promise<void> {
    for (const recipientUserId of recipientUserIds) {
      this.socketRegistry.server
        ?.to(chatUserRoom(recipientUserId))
        .emit(eventName, payload);
    }

    return Promise.resolve(); // nothing to await, just satisfy the interface
  }
}
