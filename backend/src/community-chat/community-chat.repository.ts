import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
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

const messageInclude = {
  author: { select: { id: true, name: true, image: true, role: true } },
  replyTo: {
    select: {
      id: true,
      content: true,
      deletedAt: true,
      author: { select: { id: true, name: true } },
    },
  },
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

  async lastMessageAtBy(channelId: string, authorId: string) {
    const last = await this.prisma.gameChannelMessage.findFirst({
      where: { channelId, authorId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return last?.createdAt ?? null;
  }

  createMessage(data: {
    channelId: string;
    authorId: string;
    content: string;
    replyToId?: string;
    clientMessageId?: string;
  }) {
    return this.prisma.gameChannelMessage.create({
      data,
      include: messageInclude,
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

  findReadState(userId: string, channelId: string) {
    return this.prisma.gameChannelReadState.findUnique({
      where: { userId_channelId: { userId, channelId } },
      select: { lastReadAt: true },
    });
  }

  /** Where this person has read up to in each of these rooms, in one query. */
  findReadStates(userId: string, channelIds: string[]) {
    return this.prisma.gameChannelReadState.findMany({
      where: { userId, channelId: { in: channelIds } },
      select: { channelId: true, lastReadAt: true },
    });
  }

  markRead(params: {
    userId: string;
    channelId: string;
    at: Date;
    messageId?: string;
  }) {
    const { userId, channelId, at, messageId } = params;
    const data = { lastReadAt: at, lastReadMessageId: messageId ?? null };
    return this.prisma.gameChannelReadState.upsert({
      where: { userId_channelId: { userId, channelId } },
      update: data,
      create: { userId, channelId, ...data },
    });
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
