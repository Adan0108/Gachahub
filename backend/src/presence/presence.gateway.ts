import { Injectable, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { websocketGatewayOptions } from '../websocket/websocket-gateway.options';
import { hasLiveSession } from '../websocket/socket.util';
import type { AppSocket } from '../websocket/websocket.gateway';
import { PresenceService } from './presence.service';

/**
 * Online or offline follows the live connection: a socket that connects or pings counts as here,
 * the last one going means gone. Authentication lives in WebsocketGateway; this waits for it.
 */
@Injectable()
@WebSocketGateway(websocketGatewayOptions)
export class PresenceGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(PresenceGateway.name);

  constructor(private readonly presence: PresenceService) {}

  async handleConnection(socket: AppSocket) {
    await this.markAlive(socket);
  }

  async handleDisconnect(socket: AppSocket) {
    const userId = socket.data.userId;
    if (!userId) return;

    try {
      await this.presence.socketGone(userId, socket.id);
    } catch (error) {
      this.logger.warn(`Could not mark gone: ${(error as Error).message}`);
    }
  }

  @SubscribeMessage('presence:ping')
  async handlePing(@ConnectedSocket() socket: AppSocket) {
    await this.markAlive(socket);
  }

  private async markAlive(socket: AppSocket) {
    // WebsocketGateway sets authReady in its own connection handler, which can run after this one.
    await Promise.resolve();
    await socket.data.authReady;

    const userId = socket.data.userId;
    // An expired login's socket is closed at expiry; this covers the moment before that.
    if (!userId || !hasLiveSession(socket)) return;

    try {
      await this.presence.socketAlive(userId, socket.id);
    } catch (error) {
      this.logger.warn(`Could not mark alive: ${(error as Error).message}`);
    }
  }
}
