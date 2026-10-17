import { Injectable, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { websocketGatewayOptions } from '../websocket/websocket-gateway.options';
import type { AppSocket } from '../websocket/websocket.gateway';
import { CommunityAccessService } from './community-access.service';
import { communityRoom } from './community-realtime.service';

interface RoomPayload {
  slug?: unknown;
  channelId?: unknown;
}

/** Lets a member's socket listen to a room; the same access check as reading it. */
@Injectable()
@WebSocketGateway(websocketGatewayOptions)
export class CommunityChatGateway {
  private readonly logger = new Logger(CommunityChatGateway.name);

  constructor(private readonly access: CommunityAccessService) {}

  @SubscribeMessage('community:join')
  async join(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: RoomPayload,
  ): Promise<{ ok: boolean }> {
    await socket.data.authReady;
    const userId = socket.data.userId;
    if (
      !userId ||
      typeof payload?.slug !== 'string' ||
      typeof payload?.channelId !== 'string'
    ) {
      return { ok: false };
    }

    try {
      const { game } = await this.access.scope(payload.slug, userId);
      const channel = await this.access.channelIn(game.id, payload.channelId);
      await socket.join(communityRoom(channel.id));
      return { ok: true };
    } catch (error) {
      this.logger.debug(`Join refused: ${(error as Error).message}`);
      return { ok: false };
    }
  }

  @SubscribeMessage('community:leave')
  async leave(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: RoomPayload,
  ): Promise<{ ok: boolean }> {
    if (typeof payload?.channelId !== 'string') return { ok: false };

    await socket.leave(communityRoom(payload.channelId));
    return { ok: true };
  }
}
