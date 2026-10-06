import { Injectable } from '@nestjs/common';
import { userRoom } from '../../websocket/socket.util';
import { SocketRegistry } from '../../websocket/socket-registry.service';
import {
  ChatDeliveryPort,
  ChatMessageCreatedEvent,
  ChatMessageActionEvent,
  ChatReceiptsUpdatedEvent,
  ChatRequestAcceptedEvent,
} from '../ports/chat-delivery.port';

type ChatSocketEventName =
  | 'message:created'
  | 'message:edited'
  | 'message:deleted'
  | 'reaction:added'
  | 'reaction:removed'
  | 'request:accepted'
  | 'receipts:updated';

// real ChatDeliveryPort now, was noop before, ChatService untouched either way
@Injectable()
export class SocketChatDeliveryService implements ChatDeliveryPort {
  constructor(private readonly socketRegistry: SocketRegistry) {}

  publishMessageCreated(event: ChatMessageCreatedEvent): Promise<void> {
    // recipientUserIds stay out, it leaks who else got this batch
    return this.emitToRecipients('message:created', event.recipientUserIds, {
      conversationId: event.conversationId,
      messageId: event.messageId,
      senderId: event.senderId,
      shouldNotify: event.shouldNotify,
      ciphertext: event.ciphertext,
      encryptionMeta: event.encryptionMeta,
      contentType: event.contentType,
      createdAt: event.createdAt,
      clientMessageId: event.clientMessageId,
      replyToId: event.replyToId,
      media: event.media,
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

  publishRequestAccepted(event: ChatRequestAcceptedEvent): Promise<void> {
    return this.emitToRecipients('request:accepted', event.recipientUserIds, {
      conversationId: event.conversationId,
      userId: event.userId,
    });
  }

  publishReceiptsUpdated(event: ChatReceiptsUpdatedEvent): Promise<void> {
    const { kind, conversationId, readerId } = event;
    return this.emitToRecipients('receipts:updated', event.recipientUserIds, {
      conversationId,
      userId: readerId,
      kind,
      // delivery carries no time (see SharedReceipt); a read does, to those allowed to see it
      ...(event.kind === 'delivered'
        ? { messageIds: event.messageIds }
        : { upToMessageId: event.upToMessageId, at: event.at }),
    });
  }

  // shared by edit/delete/reaction events, only the event name differs
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
        ?.to(userRoom(recipientUserId))
        .emit(eventName, payload);
    }

    return Promise.resolve(); // nothing to await, just satisfy the interface
  }
}
