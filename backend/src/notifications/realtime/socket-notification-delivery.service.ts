import { Injectable } from '@nestjs/common';

import { SocketRegistry } from '../../websocket/socket-registry.service';
import { userRoom } from '../../websocket/socket.util';

export interface NotificationSocketPayload {
  id: string;
  recipientId: string;
  actorId: string | null;
  type: string;
  entityType: string;
  entityId: string;
  readAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class SocketNotificationDeliveryService {
  constructor(private readonly socketRegistry: SocketRegistry) {}

  publish(notification: NotificationSocketPayload): void {
    this.socketRegistry.server
      ?.to(userRoom(notification.recipientId))
      .emit('notification:new', notification);
  }
}
