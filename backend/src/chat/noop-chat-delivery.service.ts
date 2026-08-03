import { Injectable } from '@nestjs/common';
import {
  ChatDeliveryPort,
  ChatMessageCreatedEvent,
} from './ports/chat-delivery.port';

/**
 * Initial delivery adapter.
 *
 * Persisted messages are syncable over REST today. WebSocket, Redis, cloud
 * pub/sub, or push notification delivery can replace this provider later.
 */
@Injectable()
export class NoopChatDeliveryService implements ChatDeliveryPort {
  publishMessageCreated(_event: ChatMessageCreatedEvent): Promise<void> {
    return Promise.resolve();
  }
}
