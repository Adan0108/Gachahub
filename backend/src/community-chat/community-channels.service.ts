import { BadRequestException, Injectable } from '@nestjs/common';
import { CommunityAccessService } from './community-access.service';
import { COMMUNITY_UNREAD_CAP } from './community-chat.constants';
import { CommunityChatRepository } from './community-chat.repository';
import type { MarkCommunityReadDto } from './dto/mark-community-read.dto';

/** A community's rooms, and where each person has read up to in them. */
@Injectable()
export class CommunityChannelsService {
  constructor(
    private readonly repository: CommunityChatRepository,
    private readonly access: CommunityAccessService,
  ) {}

  /** The community's rooms with what this person has not read yet. */
  async listChannels(slug: string, userId: string | undefined) {
    const { user, game, membership, canModerate } = await this.access.scope(
      slug,
      userId,
    );
    const channels = await this.repository.listChannels(game.id);

    // Read positions and latest times come back for every room at once; only the unread count is per room.
    const channelIds = channels.map((channel) => channel.id);
    const [readStates, latest] = await Promise.all([
      this.repository.findReadStates(user.id, channelIds),
      this.repository.lastMessageAtByChannel(channelIds),
    ]);
    const readAt = new Map(
      readStates.map((state) => [state.channelId, state.lastReadAt] as const),
    );
    const lastAt = new Map(
      latest.map((entry) => [entry.channelId, entry.lastMessageAt] as const),
    );

    const items = await Promise.all(
      channels.map(async (channel) => {
        // Someone who just joined starts with nothing unread, not the whole backlog.
        const since =
          readAt.get(channel.id) ?? membership?.createdAt ?? new Date();
        const unread = await this.repository.countUnread({
          channelId: channel.id,
          userId: user.id,
          since,
          limit: COMMUNITY_UNREAD_CAP,
        });

        return {
          id: channel.id,
          slug: channel.slug,
          name: channel.name,
          topic: channel.topic,
          kind: channel.kind,
          isLocked: channel.isLocked,
          slowmodeSeconds: channel.slowmodeSeconds,
          unreadCount: Math.min(unread, COMMUNITY_UNREAD_CAP),
          unreadCapped: unread > COMMUNITY_UNREAD_CAP,
          lastMessageAt: lastAt.get(channel.id)?.toISOString() ?? null,
        };
      }),
    );

    return { channels: items, canModerate, isMember: membership !== null };
  }

  /** Marks the channel read up to a message the reader has seen, or up to now. */
  async markRead(
    slug: string,
    channelId: string,
    dto: MarkCommunityReadDto,
    userId: string | undefined,
  ) {
    const { user, game } = await this.access.scope(slug, userId);
    const channel = await this.access.channelIn(game.id, channelId);

    let at = new Date();
    if (dto.messageId) {
      const seen = await this.repository.findCursor(channel.id, dto.messageId);
      if (!seen) throw new BadRequestException('Unknown message');
      at = seen.createdAt;
    }

    // The database keeps the position moving forward only, so an older mark arriving late changes nothing.
    await this.repository.markRead({
      userId: user.id,
      channelId: channel.id,
      at,
      messageId: dto.messageId,
    });
    return { ok: true };
  }
}
