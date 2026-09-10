import { Injectable, Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { IncomingHttpHeaders } from 'node:http';
import type { DefaultEventsMap, Server, Socket } from 'socket.io';
import { SocketRegistry } from './socket-registry.service';
import { userRoom } from './socket.util';
import { websocketGatewayOptions } from './websocket-gateway.options';
import { auth } from '../auth/auth';

// only custom bit is userId, rest stay default event maps
interface SocketData {
  userId?: string;
}

export type AppSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  SocketData
>;

/**
 * Generic WebSocket connection gateway.
 *
 * Owns authentication and room-joining only. Feature-specific message
 * handling (typing, presence, streaming, etc.) belongs in its own gateway,
 * injecting SocketRegistry to reach this same shared server.
 */
@Injectable()
@WebSocketGateway(websocketGatewayOptions)
export class WebsocketGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WebsocketGateway.name);

  constructor(private readonly socketRegistry: SocketRegistry) {}

  /**
   * Shares the Socket.IO server instance with the registry.
   */
  afterInit(server: Server) {
    this.socketRegistry.server = server;
  }

  /**
   * Authenticates a new socket connection and joins its personal room.
   *
   * No session means no room and a straight disconnect — no anonymous sockets.
   */
  async handleConnection(socket: AppSocket) {
    const userId = await this.authenticate(socket);

    if (!userId) {
      socket.disconnect(true);
      return;
    }

    socket.data.userId = userId;
    await socket.join(userRoom(userId));
  }

  handleDisconnect(socket: AppSocket) {
    this.logger.debug(`Socket disconnected: ${socket.id}`);
  }

  /**
   * Authenticates a socket using the same session check REST already trusts.
   *
   * The handshake is still plain HTTP under the hood, so this works the same way.
   */
  private async authenticate(socket: Socket): Promise<string | null> {
    try {
      const result = await auth.api.getSession({
        headers: this.toHeaders(socket.handshake.headers),
      });

      return result?.user.id ?? null;
    } catch (error) {
      this.logger.warn(`Socket auth failed: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Converts the socket handshake's plain header object into real Headers.
   *
   * getSession() needs the real thing, not the plain object the socket gives.
   */
  private toHeaders(raw: IncomingHttpHeaders): Headers {
    const headers = new Headers();

    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'string') {
        headers.set(key, value);
      }
    }

    return headers;
  }
}
