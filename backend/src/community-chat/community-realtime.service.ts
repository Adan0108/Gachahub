import { Injectable, Logger } from '@nestjs/common';
import { SocketRegistry } from '../websocket/socket-registry.service';
import { PrismaService } from '../prisma/prisma.service';
import { SanctionAccessService } from '../moderation-enforcement/sanction-access.service';
import { hasLiveSession } from '../websocket/socket.util';

export const communityRoom = (channelId: string) => `community:${channelId}`;
type RecipientData = { userId?: string; sessionExpiresAt?: number };

/** Tells everyone with a room open that something in it changed; what each person then sees is fetched per person. */
@Injectable()
export class CommunityRealtimeService {
  private readonly logger = new Logger(CommunityRealtimeService.name);
  constructor(
    private readonly registry: SocketRegistry,
    private readonly db: PrismaService,
    private readonly sanctions: SanctionAccessService,
  ) {}

  /** `messageId` is the message that was sent, edited, removed or reacted to, so listeners fetch just that one. */
  async changed(channelId: string, messageId?: string): Promise<void> {
    try {
      await this.deliver(channelId, messageId);
    } catch {
      // Fail closed for recipients, without making a committed chat write appear to fail.
      this.logger.warn('Community activity delivery unavailable');
    }
  }
  private async deliver(channelId: string, messageId?: string): Promise<void> {
    const server = this.registry.server;
    if (!server) return;
    const channel = await this.db.gameChannel.findUnique({
      where: { id: channelId },
      select: { gameId: true },
    });
    if (!channel) return;
    const room = communityRoom(channelId);
    const sockets = await server.in(room).fetchSockets();
    const ids = [
      ...new Set(
        sockets
          .map((socket) => (socket.data as RecipientData).userId)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ];
    const blocked = await this.sanctions.blockedReaders(ids, channel.gameId);
    for (const socket of sockets) {
      const data = socket.data as RecipientData;
      if (
        typeof data.userId !== 'string' ||
        !hasLiveSession({ data }) ||
        blocked.has(data.userId)
      ) {
        await Promise.resolve(socket.leave(room));
        continue;
      }
      socket.emit('community:activity', { channelId, messageId });
    }
  }
}
