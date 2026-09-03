import { Injectable, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { IncomingHttpHeaders } from 'node:http';
import type { DefaultEventsMap, Server, Socket } from 'socket.io';
import { ChatSocketRegistry } from './chat-socket-registry.service';
import { ChatService } from './chat.service';
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

interface TypingPayload {
  conversationId: string;
}

@Injectable()
@WebSocketGateway({
  cors: {
    origin: appConfig.frontendUrl,
    credentials: true,
  },
})
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly chatService: ChatService,
    private readonly socketRegistry: ChatSocketRegistry,
  ) {}

  /**
   * Shares the Socket.IO server instance with the delivery service.
   */
  afterInit(server: Server) {
    this.socketRegistry.server = server;
  }

  private readonly logger = new Logger(ChatGateway.name);
  private readonly TYPING_THROTTLE_MS = 2000;
  private readonly TYPING_RATE_LIMIT_WINDOW_MS = 1000;
  private readonly TYPING_RATE_LIMIT_MAX_EVENTS = 5;
  private readonly MAX_TRACKED_CONVERSATIONS_PER_USER = 20;
  private readonly typingThrottle = new Map<string, Map<string, number>>();
  private readonly typingRateLimiter = new Map<string, number[]>();

  /**
   * Authenticates a new socket connection and joins its personal room.
   *
   * No session means no room and a straight disconnect — no anonymous sockets.
   */
  async handleConnection(socket: ChatSocket) {
    const userId = await this.authenticate(socket);

    if (!userId) {
      socket.disconnect(true);
      return;
    }

    socket.data.userId = userId;
    await socket.join(chatUserRoom(userId));
  }

  /**
   * Clears this user's typing-throttle state on disconnect.
   */
  handleDisconnect(socket: ChatSocket) {
    this.logger.debug(`Socket disconnected: ${socket.id}`);

    const userId = socket.data.userId;

    if (userId) {
      this.typingThrottle.delete(userId);
      this.typingRateLimiter.delete(userId);
    }
  }

  /**
   * Handles a "typing started" event from the client.
   */
  @SubscribeMessage('typing:start')
  async handleTypingStart(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody() payload: TypingPayload,
  ) {
    await this.broadcastTyping(socket, payload, 'typing:start');
  }

  /**
   * Handles a "typing stopped" event from the client.
   */
  @SubscribeMessage('typing:stop')
  async handleTypingStop(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody() payload: TypingPayload,
  ) {
    await this.broadcastTyping(socket, payload, 'typing:stop');
  }

  /**
   * Validates and broadcasts a typing event to the conversation's participants.
   *
   * Shared by start/stop — only the event name and intent differ.
   */
  private async broadcastTyping(
    socket: ChatSocket,
    payload: TypingPayload,
    event: 'typing:start' | 'typing:stop',
  ) {
    const userId = socket.data.userId;

    if (
      !userId ||
      !payload?.conversationId ||
      typeof payload.conversationId !== 'string'
    ) {
      return;
    }

    if (this.isTypingRateLimited(userId)) {
      return;
    }

    if (this.isTypingEventThrottled(userId, payload.conversationId, event)) {
      return;
    }

    const recipientUserIds = await this.chatService.getTypingRecipients(
      payload.conversationId,
      userId,
    );

    for (const recipientUserId of recipientUserIds) {
      this.server.to(chatUserRoom(recipientUserId)).emit(event, {
        conversationId: payload.conversationId,
        userId,
      });
    }
  }

  /**
   * True when this user has already fired too many typing events across all
   * conversations recently. Checked before the per-conversation map is ever
   * touched, so spamming distinct/fake conversation ids can't grow it unbounded.
   */
  private isTypingRateLimited(userId: string): boolean {
    const now = Date.now();
    const windowStart = now - this.TYPING_RATE_LIMIT_WINDOW_MS;
    const recentEvents = (this.typingRateLimiter.get(userId) ?? []).filter(
      (timestamp) => timestamp > windowStart,
    );

    if (recentEvents.length >= this.TYPING_RATE_LIMIT_MAX_EVENTS) {
      this.typingRateLimiter.set(userId, recentEvents);
      return true;
    }

    recentEvents.push(now);
    this.typingRateLimiter.set(userId, recentEvents);
    return false;
  }

  /**
   * True when this user already fired the same typing event for this
   * conversation within the throttle window; records the emit otherwise.
   */
  private isTypingEventThrottled(
    userId: string,
    conversationId: string,
    event: 'typing:start' | 'typing:stop',
  ): boolean {
    const now = Date.now();
    const key = `${event}:${conversationId}`;
    const userThrottle = this.typingThrottle.get(userId);
    const lastEmittedAt = userThrottle?.get(key);

    if (
      lastEmittedAt !== undefined &&
      now - lastEmittedAt < this.TYPING_THROTTLE_MS
    ) {
      return true;
    }

    if (userThrottle) {
      if (
        !userThrottle.has(key) &&
        userThrottle.size >= this.MAX_TRACKED_CONVERSATIONS_PER_USER
      ) {
        const [oldestKey] = userThrottle.keys();
        userThrottle.delete(oldestKey);
      }

      userThrottle.set(key, now);
    } else {
      this.typingThrottle.set(userId, new Map([[key, now]]));
    }

    return false;
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
