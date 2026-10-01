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
import { sessionRoom, userRoom } from './socket.util';
import { websocketGatewayOptions } from './websocket-gateway.options';
import { auth } from '../auth/auth';

// only custom bit is userId, rest stay default event maps
interface SocketData {
  userId?: string;
  /**
   * Resolves once this connection's auth attempt has settled (success or not). Sibling gateways on
   * this same socket (e.g. ChatTypingGateway) can be reached before handleConnection's async auth
   * finishes - awaiting this instead of reading userId directly avoids treating "not authenticated
   * yet" the same as "genuinely unauthenticated".
   */
  authReady?: Promise<void>;
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
    // Assigned before any other await so a sibling gateway's handler for this same socket - which
    // Socket.IO can already dispatch to while this is still pending - has something to wait on
    // instead of reading a not-yet-set socket.data.userId.
    const ready = this.authenticateAndJoin(socket);
    socket.data.authReady = ready;
    await ready;
  }

  private async authenticateAndJoin(socket: AppSocket): Promise<void> {
    const identity = await this.authenticate(socket);

    if (identity === 'error') {
      // A backend hiccup: drop the socket without any signed-out signal.
      socket.disconnect(true);
      return;
    }
    if (identity === 'no-session') {
      // Explicit, so the browser signs out only when told - never on a plain drop.
      socket.emit('session:revoked');
      socket.disconnect(true);
      return;
    }

    socket.data.userId = identity.userId;
    await socket.join(userRoom(identity.userId));
    await socket.join(sessionRoom(identity.sessionId));
  }

  handleDisconnect(socket: AppSocket) {
    this.logger.debug(`Socket disconnected: ${socket.id}`);
  }

  /**
   * Authenticates a socket using the same session check REST already trusts.
   *
   * The handshake is still plain HTTP under the hood, so this works the same way.
   */
  private async authenticate(
    socket: Socket,
  ): Promise<{ userId: string; sessionId: string } | 'no-session' | 'error'> {
    try {
      const result = await auth.api.getSession({
        headers: this.toHeaders(socket.handshake.headers),
      });

      return result
        ? { userId: result.user.id, sessionId: result.session.id }
        : 'no-session';
    } catch (error) {
      this.logger.warn(`Socket auth failed: ${(error as Error).message}`);
      return 'error';
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
