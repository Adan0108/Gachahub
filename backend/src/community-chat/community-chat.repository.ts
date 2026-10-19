import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { claimUploadsForAttachment } from '../media/media.repository';
import { PrismaService } from '../prisma/prisma.service';
import { COMMUNITY_DEFAULT_CHANNEL } from './community-chat.constants';

const emoteSelect = {
  id: true,
  shortcode: true,
  unicode: true,
  imageUrl: true,
  animationUrl: true,
  width: true,
  height: true,
  mimeType: true,
  deletedAt: true,
} satisfies Prisma.ChatEmoteSelect;

const reactionSelect = {
  userId: true,
  emoji: true,
  emoteId: true,
  emote: { select: emoteSelect },
} satisfies Prisma.GameChannelReactionSelect;

const mediaSelect = {
  id: true,
  url: true,
  width: true,
  height: true,
  mediaUploadId: true,
} satisfies Prisma.GameChannelMessageMediaSelect;

export interface CommunityMediaInput {
  mediaUploadId: string;
  publicId: string;
  url: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  format: string | null;
}

const messageInclude = {
  author: { select: { id: true, name: true, image: true, role: true } },
  replyTo: {
    select: {
      id: true,
      content: true,
      deletedAt: true,
      author: { select: { id: true, name: true } },
      media: { select: { id: true }, take: 1 },
    },
  },
  media: { orderBy: { sortOrder: 'asc' }, select: mediaSelect },
  reactions: { orderBy: { createdAt: 'asc' }, select: reactionSelect },
} satisfies Prisma.GameChannelMessageInclude;

export type CommunityMessageRow = Prisma.GameChannelMessageGetPayload<{
  include: typeof messageInclude;
}>;

export type CommunityReactionRow = Prisma.GameChannelReactionGetPayload<{
  select: typeof reactionSelect;
}>;

export type CommunityChannelRow = Prisma.GameChannelGetPayload<object>;

@Injectable()
export class CommunityChatRepository {
  constructor(private readonly prisma: PrismaService) {}

  findGameBySlug(slug: string) {
    return this.prisma.game.findUnique({
      where: { slug },
      select: { id: true, slug: true, name: true, status: true },
    });
  }

  findMembership(gameId: string, userId: string) {
    return this.prisma.gameMember.findUnique({
      where: { gameId_userId: { gameId, userId } },
      select: { createdAt: true },
    });
  }

  /** Which of these users moderate the game, to badge their messages. */
  async findModeratorIds(gameId: string, userIds: string[]) {
    if (userIds.length === 0) return new Set<string>();
    const rows = await this.prisma.gameModerator.findMany({
      where: { gameId, userId: { in: userIds } },
      select: { userId: true },
    });
    return new Set(rows.map((row) => row.userId));
  }

  /** The community's rooms; the default one is created the first time anyone looks. */
  async listChannels(gameId: string): Promise<CommunityChannelRow[]> {
    const find = () =>
      this.prisma.gameChannel.findMany({
        where: { gameId, archivedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });

    const found = await find();
    if (found.length > 0) return found;

    // Two people opening a new community's chat at once both get here; the unique (game, slug) lets one win and the other carry on.
    await this.prisma.gameChannel.createMany({
      data: [{ gameId, ...COMMUNITY_DEFAULT_CHANNEL, sortOrder: 0 }],
      skipDuplicates: true,
    });
    return find();
  }

  findChannel(gameId: string, channelId: string) {
    return this.prisma.gameChannel.findFirst({
      where: { id: channelId, gameId, archivedAt: null },
    });
  }

  /** A message together with its room, so callers can check it belongs to the community in the route. */
  findMessageInGame(messageId: string, gameId: string) {
    return this.prisma.gameChannelMessage.findFirst({
      where: { id: messageId, channel: { gameId } },
      include: {
        ...messageInclude,
        channel: { select: { id: true, gameId: true, isLocked: true } },
      },
    });
  }

  findMessageInChannel(messageId: string, channelId: string) {
    return this.prisma.gameChannelMessage.findFirst({
      where: { id: messageId, channelId },
      select: { id: true },
    });
  }

  findCursor(channelId: string, messageId: string) {
    return this.prisma.gameChannelMessage.findFirst({
      where: { id: messageId, channelId },
      select: { id: true, createdAt: true },
    });
  }

  /** Newest first, one extra row so the caller can tell whether older ones remain. */
  listMessages(params: {
    channelId: string;
    before: { id: string; createdAt: Date } | null;
    limit: number;
  }) {
    const { channelId, before, limit } = params;
    return this.prisma.gameChannelMessage.findMany({
      where: {
        channelId,
        ...(before
          ? {
              OR: [
                { createdAt: { lt: before.createdAt } },
                { createdAt: before.createdAt, id: { lt: before.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: messageInclude,
    });
  }

  findByClientMessageId(authorId: string, clientMessageId: string) {
    return this.prisma.gameChannelMessage.findFirst({
      where: { authorId, clientMessageId },
      include: messageInclude,
    });
  }

  /**
   * Saves a message. With slow mode on, the wait check and the insert happen under one lock per
   * person and room, so two requests at once cannot both pass; the loser gets how long to wait.
   * Images are claimed in the same transaction, so a message never points at an upload someone else took.
   */
  async createMessage(
    data: {
      channelId: string;
      authorId: string;
      content: string;
      replyToId?: string;
      clientMessageId?: string;
    },
    slowmodeSeconds = 0,
    media: CommunityMediaInput[] = [],
  ): Promise<{ created: CommunityMessageRow } | { waitMs: number }> {
    if (slowmodeSeconds <= 0 && media.length === 0) {
      const created = await this.prisma.gameChannelMessage.create({
        data,
        include: messageInclude,
      });
      return { created };
    }

    return this.prisma.$transaction(async (tx) => {
      if (slowmodeSeconds > 0) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${data.channelId}:${data.authorId}`}, 0))`;

        const last = await tx.gameChannelMessage.findFirst({
          where: { channelId: data.channelId, authorId: data.authorId },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        });
        if (last) {
          const waitMs =
            slowmodeSeconds * 1000 - (Date.now() - last.createdAt.getTime());
          if (waitMs > 0) return { waitMs };
        }
      }

      if (media.length > 0) {
        await claimUploadsForAttachment(tx, {
          ids: media.map((item) => item.mediaUploadId),
          userId: data.authorId,
          purpose: 'COMMUNITY',
        });
      }

      const created = await tx.gameChannelMessage.create({
        data: {
          ...data,
          media: {
            create: media.map((item, sortOrder) => ({ ...item, sortOrder })),
          },
        },
        include: messageInclude,
      });
      return { created };
    });
  }

  updateContent(messageId: string, content: string) {
    return this.prisma.gameChannelMessage.update({
      where: { id: messageId },
      data: { content, editedAt: new Date() },
      include: messageInclude,
    });
  }

  softDelete(messageId: string, deletedById: string, reason?: string) {
    return this.prisma.gameChannelMessage.update({
      where: { id: messageId },
      data: {
        deletedAt: new Date(),
        deletedById,
        deleteReason: reason ?? null,
      },
      include: messageInclude,
    });
  }

  /** A global emote, or one of this community's own; deleted ones are not usable. */
  findUsableEmote(emoteId: string, gameId: string) {
    return this.prisma.chatEmote.findFirst({
      where: {
        id: emoteId,
        deletedAt: null,
        OR: [{ scope: 'GLOBAL' }, { scope: 'GAME', gameId }],
      },
      select: { id: true },
    });
  }

  upsertReaction(params: {
    messageId: string;
    userId: string;
    emoji?: string;
    emoteId?: string;
  }) {
    const { messageId, userId, emoji, emoteId } = params;
    // One reaction per person per message: a new choice replaces the old one.
    const choice = { emoji: emoji ?? null, emoteId: emoteId ?? null };
    return this.prisma.gameChannelReaction.upsert({
      where: { messageId_userId: { messageId, userId } },
      update: choice,
      create: { messageId, userId, ...choice },
    });
  }

  deleteReaction(messageId: string, userId: string) {
    return this.prisma.gameChannelReaction.deleteMany({
      where: { messageId, userId },
    });
  }

  /** Every reaction on one message, oldest first. */
  findReactions(messageId: string) {
    return this.prisma.gameChannelReaction.findMany({
      where: { messageId },
      orderBy: { createdAt: 'asc' },
      select: reactionSelect,
    });
  }

  /** Where this person has read up to in each of these rooms, in one query. */
  findReadStates(userId: string, channelIds: string[]) {
    return this.prisma.gameChannelReadState.findMany({
      where: { userId, channelId: { in: channelIds } },
      select: { channelId: true, lastReadAt: true },
    });
  }

  /** Moves the read position forward only; an older position arriving late, from another tab, changes nothing. */
  async markRead(params: {
    userId: string;
    channelId: string;
    at: Date;
    messageId?: string;
  }) {
    const { userId, channelId, at, messageId } = params;
    await this.prisma.$executeRaw`
      INSERT INTO "game_channel_read_states" ("userId", "channelId", "lastReadAt", "lastReadMessageId", "updatedAt")
      VALUES (${userId}, ${channelId}, ${at}, ${messageId ?? null}, NOW())
      ON CONFLICT ("userId", "channelId") DO UPDATE
      SET "lastReadAt" = EXCLUDED."lastReadAt",
          "lastReadMessageId" = EXCLUDED."lastReadMessageId",
          "updatedAt" = NOW()
      WHERE "game_channel_read_states"."lastReadAt" < EXCLUDED."lastReadAt"`;
  }

  /** Messages from other people after `since`, up to `limit` and one more; enough for a "99+" badge without counting a whole backlog. */
  async countUnread(params: {
    channelId: string;
    userId: string;
    since: Date;
    limit: number;
  }) {
    const { channelId, userId, since, limit } = params;
    const rows = await this.prisma.gameChannelMessage.findMany({
      where: {
        channelId,
        deletedAt: null,
        createdAt: { gt: since },
        NOT: { authorId: userId },
      },
      select: { id: true },
      take: limit + 1,
    });
    return rows.length;
  }

  /** The newest visible message time of each room, in one query. */
  async lastMessageAtByChannel(channelIds: string[]) {
    const rows = await this.prisma.gameChannelMessage.groupBy({
      by: ['channelId'],
      where: { channelId: { in: channelIds }, deletedAt: null },
      _max: { createdAt: true },
    });
    return rows.flatMap((row) =>
      row._max.createdAt
        ? [{ channelId: row.channelId, lastMessageAt: row._max.createdAt }]
        : [],
    );
  }
}
