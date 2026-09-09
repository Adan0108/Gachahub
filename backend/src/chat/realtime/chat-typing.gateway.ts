import { Injectable } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server } from 'socket.io';
import { userRoom } from '../../websocket/socket.util';
import { websocketGatewayOptions } from '../../websocket/websocket-gateway.options';
import type { AppSocket } from '../../websocket/websocket.gateway';
import { DiscordLoggerService } from '../../common/discord/discord-logger.service';
import { ChatService } from '../chat.service';
import { ChatTypingService, TypingEventName } from './chat-typing.service';

interface TypingPayload {
  conversationId: string;
}

/**
 * Handles typing-indicator socket events for chat.
 *
 * Connection/auth lives in WebsocketGateway — this reacts to
 * typing:start/typing:stop once a socket is already authenticated. No
 * distinct namespace is set here, so it shares the same underlying server.
 */
@Injectable()
@WebSocketGateway(websocketGatewayOptions)
export class ChatTypingGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly chatService: ChatService,
    private readonly chatTypingService: ChatTypingService,
    private readonly discordLogger: DiscordLoggerService,
  ) {}

  /**
   * Clears this user's typing-throttle state on disconnect.
   */
  handleDisconnect(socket: AppSocket) {
    const userId = socket.data.userId;

    if (userId && !this.hasOtherActiveSockets(userId)) {
      this.chatTypingService.clearUser(userId);
    }
  }

  private hasOtherActiveSockets(userId: string): boolean {
    const room = this.server.sockets.adapter.rooms.get(userRoom(userId));
    return (room?.size ?? 0) > 0;
  }

  /**
   * Handles a "typing started" event from the client.
   */
  @SubscribeMessage('typing:start')
  async handleTypingStart(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: TypingPayload,
  ) {
    await this.broadcastTyping(socket, payload, 'typing:start');
  }

  /**
   * Handles a "typing stopped" event from the client.
   */
  @SubscribeMessage('typing:stop')
  async handleTypingStop(
    @ConnectedSocket() socket: AppSocket,
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
    socket: AppSocket,
    payload: TypingPayload,
    event: TypingEventName,
  ) {
    const userId = socket.data.userId;

    if (
      !userId ||
      !payload?.conversationId ||
      typeof payload.conversationId !== 'string'
    ) {
      return;
    }

    if (
      this.chatTypingService.shouldSuppress(
        userId,
        payload.conversationId,
        event,
      )
    ) {
      return;
    }

    try {
      const recipientUserIds = await this.chatService.getTypingRecipients(
        payload.conversationId,
        userId,
      );

      for (const recipientUserId of recipientUserIds) {
        this.server.to(userRoom(recipientUserId)).emit(event, {
          conversationId: payload.conversationId,
          userId,
        });
      }
    } catch (error) {
      const errorName = error instanceof Error ? error.constructor.name : 'UnknownError';

      void this.discordLogger.sendError({
        source: 'socket',
        title: `Socket error on ${event}`,
        errorName,
        fields: [
          { name: 'Event', value: event, inline: true },
          { name: 'Error', value: errorName, inline: true },
          { name: 'Conversation', value: payload.conversationId, inline: false },
          {
            name: 'Message',
            value: error instanceof Error ? error.message : 'Unknown error',
            inline: false,
          },
        ],
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }
}
