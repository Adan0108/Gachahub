import { Injectable, Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { IncomingHttpHeaders } from 'node:http';
import type { DefaultEventsMap, Server, Socket } from 'socket.io';
import { auth } from '../auth/auth';
import { appConfig } from '../config/app.config';
import { chatUserRoom } from './chat-socket.util';

// only custom bit is userId, rest stay default event maps
interface ChatSocketData {
  userId?: string;
}

type ChatSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  ChatSocketData
>;

@Injectable()
@WebSocketGateway({
  cors: {
    origin: appConfig.frontendUrl,
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  // no session, no room, straight disconnect, no anon sockets
  async handleConnection(socket: ChatSocket) {
    const userId = await this.authenticate(socket);

    if (!userId) {
      socket.disconnect(true);
      return;
    }

    socket.data.userId = userId;
    await socket.join(chatUserRoom(userId));
  }

  handleDisconnect(socket: ChatSocket) {
    this.logger.debug(`Socket disconnected: ${socket.id}`);
  }

  // same session check REST already trusts, handshake is still http under the hood
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

  // getSession wants real Headers, socket gives plain object, convert
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
