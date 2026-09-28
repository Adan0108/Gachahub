import { ConflictException, Injectable } from '@nestjs/common';
import {
  ChatMessageContentType,
  ChatParticipantRole,
  ChatParticipantState,
  MediaResourceType,
  Prisma,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MlsGroupRosterRepository } from '../mls-group-roster/mls-group-roster.repository';
import { pendingSinceChange } from './membership/apply-participant-transitions';
import { lockConversation } from './membership/lock-conversation';
import {
  claimUploadsForAttachment,
  type PrismaTransaction,
} from '../media/media.repository';

/** An upload already validated by ChatService, ready to be claimed and attached to a message. */
export type ChatMessageMediaInput = {
  mediaUploadId: string;
  assetId: string;
  publicId: string;
  url: string;
  resourceType: MediaResourceType;
  sortOrder: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  bytes: number | null;
  format: string | null;
};

/** Chat database queries only; business decisions, permissions and delivery belong in ChatService. */
@Injectable()
export class ChatRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mlsGroupRosterRepository: MlsGroupRosterRepository,
  ) {}

  /** Finds a user by id. */
  findUserById(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
    });
  }

  /** Finds active users by id list, skipping inactive or missing accounts. */
  findActiveUsersByIds(userIds: string[]) {
    return this.prisma.user.findMany({
      where: {
        id: {
          in: userIds,
        },
        status: 'ACTIVE',
      },
      select: {
        id: true,
        messageRequestSetting: true,
      },
    });
  }

  /** Finds the direct-pair record for two normalized user ids. */
  findDirectPair(userIdA: string, userIdB: string) {
    return this.prisma.chatDirectPair.findUnique({
      where: {
        userIdA_userIdB: {
          userIdA,
          userIdB,
        },
      },
      include: {
        conversation: {
          include: {
            participants: true,
          },
        },
      },
    });
  }

  /** Finds a message by sender and client idempotency key. */
  findMessageBySenderClientMessageId(
    senderId: string,
    clientMessageId?: string,
  ) {
    if (!clientMessageId) {
      return null;
    }

    return this.prisma.chatMessage.findUnique({
      where: {
        senderId_clientMessageId: {
          senderId,
          clientMessageId,
        },
      },
      include: {
        receipts: true,
        replyTo: true,
        media: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
  }

  /** Finds one participant row; participant state is the source of truth for permissions. */
  findParticipant(conversationId: string, userId: string) {
    return this.prisma.chatParticipant.findUnique({
      where: {
        conversationId_userId: {
          conversationId,
          userId,
        },
      },
    });
  }

  /** Lists all participants in a convo. */
  findParticipants(conversationId: string) {
    return this.prisma.chatParticipant.findMany({
      where: { conversationId },
    });
  }

  /** Creates a direct convo and its first message in one transaction. */
  async createDirectConversationWithMessage(params: {
    senderId: string;
    recipientUserId: string;
    userIdA: string;
    userIdB: string;
    recipientState: ChatParticipantState;
    ciphertext: string;
    encryptionMeta?: Prisma.InputJsonValue;
    contentType?: ChatMessageContentType;
    clientMessageId?: string;
    replyToId?: string;
    media?: ChatMessageMediaInput[];
  }) {
    return this.prisma.$transaction(async (tx) => {
      const conversation = await tx.chatConversation.create({
        data: {
          type: 'DIRECT',
          createdBy: params.senderId,
          directPair: {
            create: {
              userIdA: params.userIdA,
              userIdB: params.userIdB,
            },
          },
          participants: {
            create: [
              {
                userId: params.senderId,
                state: 'ACTIVE',
              },
              {
                userId: params.recipientUserId,
                state: params.recipientState,
                ...pendingSinceChange(null, params.recipientState, new Date()),
              },
            ],
          },
        },
        include: {
          participants: true,
        },
      });

      const message = await this.createMessageInTransaction(tx, {
        conversationId: conversation.id,
        senderId: params.senderId,
        participantUserIds: conversation.participants.map(
          (participant) => participant.userId,
        ),
        ciphertext: params.ciphertext,
        encryptionMeta: params.encryptionMeta,
        contentType: params.contentType,
        clientMessageId: params.clientMessageId,
        replyToId: params.replyToId,
        media: params.media,
      });

      await tx.chatConversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageId: message.id,
        },
      });

      return {
        conversation,
        message,
      };
    });
  }

  /** Creates a group and participant rows; the creator is OWNER and ACTIVE, others get the state ChatService resolved. */
  createGroupConversation(params: {
    creatorId: string;
    title: string;
    photoUrl?: string;
    members: Array<{ userId: string; state: 'ACTIVE' | 'PENDING' }>;
  }) {
    const now = new Date();

    return this.prisma.chatConversation.create({
      data: {
        type: 'GROUP',
        title: params.title,
        photoUrl: params.photoUrl,
        createdBy: params.creatorId,
        participants: {
          create: [
            {
              userId: params.creatorId,
              role: 'OWNER',
              state: 'ACTIVE',
            },
            ...params.members.map((member) => ({
              userId: member.userId,
              role: 'MEMBER' as const,
              state: member.state,
              ...pendingSinceChange(null, member.state, now),
            })),
          ],
        },
      },
      include: {
        participants: true,
      },
    });
  }

  /** Updates group conversation metadata. */
  updateGroupConversation(params: {
    conversationId: string;
    title?: string;
    photoUrl?: string;
  }) {
    return this.prisma.chatConversation.update({
      where: {
        id: params.conversationId,
      },
      data: {
        title: params.title,
        photoUrl: params.photoUrl,
      },
      include: {
        participants: true,
      },
    });
  }

  /** Swaps OWNER between two participants under the conversation lock; each write only matches the state the caller checked. */
  transferGroupOwnership(
    conversationId: string,
    currentOwnerUserId: string,
    newOwnerUserId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await lockConversation(tx, conversationId);

      const promoted = await tx.chatParticipant.updateMany({
        where: { conversationId, userId: newOwnerUserId, state: 'ACTIVE' },
        data: { role: 'OWNER' },
      });
      const demoted = await tx.chatParticipant.updateMany({
        where: { conversationId, userId: currentOwnerUserId, role: 'OWNER' },
        data: { role: 'ADMIN' },
      });

      if (promoted.count !== 1 || demoted.count !== 1) {
        throw new ConflictException('Group membership changed, try again');
      }

      // A $transaction callback resolving to undefined sends an empty body, which makes fetch's response.json() throw.
      return tx.chatParticipant.findUniqueOrThrow({
        where: {
          conversationId_userId: { conversationId, userId: newOwnerUserId },
        },
      });
    });
  }

  updateParticipantRole(
    conversationId: string,
    userId: string,
    role: ChatParticipantRole,
  ) {
    return this.prisma.chatParticipant.update({
      where: {
        conversationId_userId: {
          conversationId,
          userId,
        },
      },
      data: { role },
    });
  }

  /** Finds a conversation with participants for group permission checks. */
  findConversationWithParticipants(conversationId: string) {
    return this.prisma.chatConversation.findUnique({
      where: {
        id: conversationId,
      },
      include: {
        participants: true,
      },
    });
  }

  /** Creates an encrypted message in an existing conversation and updates lastMessageId. */
  async createMessage(params: {
    conversationId: string;
    senderId: string;
    participantUserIds: string[];
    ciphertext: string;
    encryptionMeta?: Prisma.InputJsonValue;
    contentType?: ChatMessageContentType;
    clientMessageId?: string;
    replyToId?: string;
    media?: ChatMessageMediaInput[];
  }) {
    return this.prisma.$transaction(async (tx) => {
      const message = await this.createMessageInTransaction(tx, params);

      await tx.chatConversation.update({
        where: { id: params.conversationId },
        data: {
          lastMessageId: message.id,
        },
      });

      return message;
    });
  }

  /** Inserts a message in a transaction; sender receipts start delivered/read, others unread, and media is claimed here too. */
  private async createMessageInTransaction(
    tx: PrismaTransaction,
    params: {
      conversationId: string;
      senderId: string;
      participantUserIds: string[];
      ciphertext: string;
      encryptionMeta?: Prisma.InputJsonValue;
      contentType?: ChatMessageContentType;
      clientMessageId?: string;
      replyToId?: string;
      media?: ChatMessageMediaInput[];
    },
  ) {
    const now = new Date();

    const message = await tx.chatMessage.create({
      data: {
        conversationId: params.conversationId,
        senderId: params.senderId,
        ciphertext: params.ciphertext,
        encryptionMeta: params.encryptionMeta,
        contentType: params.contentType ?? 'TEXT',
        clientMessageId: params.clientMessageId,
        replyToId: params.replyToId,
        receipts: {
          create: params.participantUserIds.map((userId) => ({
            userId,
            deliveredAt: userId === params.senderId ? now : undefined,
            readAt: userId === params.senderId ? now : undefined,
          })),
        },
      },
      include: {
        receipts: true,
        replyTo: true,
      },
    });

    const media = params.media?.length
      ? await this.attachMediaInTransaction(
          tx,
          message.id,
          params.senderId,
          params.media,
        )
      : [];

    return { ...message, media };
  }

  /** Claims each upload (UPLOADED, owned by senderId, purpose CHAT) and creates its ChatMessageMedia row; throws if any was already claimed. */
  private async attachMediaInTransaction(
    tx: PrismaTransaction,
    messageId: string,
    senderId: string,
    media: ChatMessageMediaInput[],
  ) {
    const mediaUploadIds = media.map((item) => item.mediaUploadId);

    await claimUploadsForAttachment(tx, {
      ids: mediaUploadIds,
      userId: senderId,
      purpose: 'CHAT',
    });

    await tx.chatMessageMedia.createMany({
      data: media.map((item) => ({
        messageId,
        mediaUploadId: item.mediaUploadId,
        assetId: item.assetId,
        publicId: item.publicId,
        url: item.url,
        resourceType: item.resourceType,
        sortOrder: item.sortOrder,
        width: item.width,
        height: item.height,
        duration: item.duration,
        bytes: item.bytes,
        format: item.format,
      })),
    });

    return tx.chatMessageMedia.findMany({
      where: { messageId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /** Finds convos for one inbox state, including the latest encrypted message. */
  findInboxConversations(userId: string, state: ChatParticipantState) {
    return this.prisma.chatConversation.findMany({
      where: {
        participants: {
          some: {
            userId,
            state,
            deletedAt: null,
          },
        },
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                image: true,
              },
            },
          },
        },
        messages: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
          include: {
            receipts: {
              where: {
                userId,
              },
            },
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });
  }

  /** Counts unread messages across many conversations in one query. */
  async countUnreadMessagesForConversations(
    conversationIds: string[],
    userId: string,
  ) {
    if (conversationIds.length === 0) {
      return [];
    }

    return this.prisma.chatMessage.groupBy({
      by: ['conversationId'],
      where: {
        conversationId: { in: conversationIds },
        senderId: { not: userId },
        status: 'SENT',
        receipts: {
          some: {
            userId,
            readAt: null,
          },
        },
      },
      _count: {
        _all: true,
      },
    });
  }

  /** Counts unread messages in the accepted inbox, excluding own messages, pending requests and archived chats. */
  countUnreadMessagesForUser(userId: string) {
    return this.prisma.chatMessageReceipt.count({
      where: {
        userId,
        readAt: null,
        message: {
          status: 'SENT',
          senderId: {
            not: userId,
          },
          conversation: {
            participants: {
              some: {
                userId,
                state: 'ACTIVE',
                deletedAt: null,
              },
            },
          },
        },
      },
    });
  }

  /** Counts main-inbox convos with at least one unread message. */
  countUnreadConversationsForUser(userId: string) {
    return this.prisma.chatConversation.count({
      where: {
        participants: {
          some: {
            userId,
            state: 'ACTIVE',
            deletedAt: null,
          },
        },
        messages: {
          some: {
            status: 'SENT',
            senderId: {
              not: userId,
            },
            receipts: {
              some: {
                userId,
                readAt: null,
              },
            },
          },
        },
      },
    });
  }

  /** Finds encrypted messages newest-first with cursor pagination. */
  findMessages(params: {
    conversationId: string;
    beforeMessageId?: string;
    limit: number;
  }) {
    return this.prisma.chatMessage.findMany({
      where: {
        conversationId: params.conversationId,
        status: 'SENT',
      },
      ...(params.beforeMessageId
        ? {
            cursor: {
              id: params.beforeMessageId,
            },
            skip: 1,
          }
        : {}),
      take: params.limit,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        receipts: true,
        reactions: {
          include: {
            emote: true,
          },
        },
        replyTo: true,
        media: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
  }

  findSentMessageInConversation(messageId: string, conversationId: string) {
    return this.prisma.chatMessage.findFirst({
      where: {
        id: messageId,
        conversationId,
        status: 'SENT',
      },
    });
  }

  /** Updates a user's participant state in a conversation, stamping state-specific timestamps. */
  updateParticipantState(
    conversationId: string,
    userId: string,
    state: ChatParticipantState,
  ) {
    const now = new Date();

    return this.prisma.chatParticipant.update({
      where: {
        conversationId_userId: {
          conversationId,
          userId,
        },
      },
      data: {
        state,
        pendingSince: state === 'PENDING' ? now : null,
        blockedAt: state === 'BLOCKED' ? now : undefined,
        archivedAt: state === 'ARCHIVED' ? now : undefined,
      },
    });
  }

  /** Closes a group whose owner leaves as sole active member: marks the owner DECLINED and retires their device leaves in one transaction, with no Commit. */
  async closeSoleOwnerGroup(
    conversationId: string,
    userId: string,
    currentEpoch: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const participant = await tx.chatParticipant.update({
        where: {
          conversationId_userId: { conversationId, userId },
        },
        data: { state: 'DECLINED' },
      });

      const activeLeaves = await this.mlsGroupRosterRepository.findActiveLeaves(
        conversationId,
        tx,
      );
      const ownDeviceIds = activeLeaves
        .filter((leaf) => leaf.userId === userId)
        .map((leaf) => leaf.deviceId);
      await this.mlsGroupRosterRepository.removeLeaves(
        conversationId,
        ownDeviceIds,
        currentEpoch,
        tx,
      );

      return participant;
    });
  }

  /** Marks selected receipts delivered for a user; only empty deliveredAt is updated. */
  markMessagesDelivered(userId: string, messageIds: string[]) {
    return this.prisma.chatMessageReceipt.updateMany({
      where: {
        userId,
        messageId: {
          in: messageIds,
        },
        deliveredAt: null,
      },
      data: {
        deliveredAt: new Date(),
      },
    });
  }

  /** Marks messages up to lastReadMessageId (default: latest) read and updates lastReadAt in the same transaction. */
  markConversationRead(params: {
    conversationId: string;
    userId: string;
    lastReadMessageId?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const lastReadMessage = params.lastReadMessageId
        ? await tx.chatMessage.findFirst({
            where: {
              id: params.lastReadMessageId,
              conversationId: params.conversationId,
              status: 'SENT',
            },
          })
        : await tx.chatMessage.findFirst({
            where: {
              conversationId: params.conversationId,
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          });

      if (!lastReadMessage) {
        return { count: 0 };
      }

      const now = new Date();

      const result = await tx.chatMessageReceipt.updateMany({
        where: {
          userId: params.userId,
          readAt: null,
          message: {
            conversationId: params.conversationId,
            OR: [
              { createdAt: { lt: lastReadMessage.createdAt } },
              {
                createdAt: lastReadMessage.createdAt,
                id: { lte: lastReadMessage.id },
              },
            ],
          },
        },
        data: {
          deliveredAt: now,
          readAt: now,
        },
      });

      await tx.chatParticipant.update({
        where: {
          conversationId_userId: {
            conversationId: params.conversationId,
            userId: params.userId,
          },
        },
        data: {
          lastReadAt: now,
        },
      });

      return result;
    });
  }

  /** Finds a message and its conversation participants. */
  findMessageWithParticipants(messageId: string) {
    return this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      include: {
        conversation: {
          include: {
            participants: true,
          },
        },
        media: true,
      },
    });
  }

  /** Removes a message's attachment link; deleteMany keeps it safe to repeat. */
  deleteMessageMediaByUploadId(mediaUploadId: string) {
    return this.prisma.chatMessageMedia.deleteMany({
      where: { mediaUploadId },
    });
  }

  /** Marks an upload DELETED and drops its link row in one transaction, after the Cloudinary asset is destroyed. */
  finalizeReleasedMedia(mediaUploadId: string) {
    return this.prisma.$transaction([
      this.prisma.mediaUpload.updateMany({
        where: {
          id: mediaUploadId,
          status: { in: ['ATTACHED', 'RELEASE_FAILED'] },
        },
        data: { status: 'DELETED', deletedAt: new Date() },
      }),
      this.prisma.chatMessageMedia.deleteMany({
        where: { mediaUploadId },
      }),
    ]);
  }

  /** Updates an existing encrypted message payload; the service checks permissions first. */
  updateMessage(params: {
    messageId: string;
    ciphertext: string;
    encryptionMeta?: Prisma.InputJsonValue;
    contentType?: ChatMessageContentType;
  }) {
    return this.prisma.chatMessage.update({
      where: {
        id: params.messageId,
      },
      data: {
        ciphertext: params.ciphertext,
        encryptionMeta: params.encryptionMeta,
        contentType: params.contentType,
        editedAt: new Date(),
      },
      include: {
        receipts: true,
        reactions: {
          include: {
            emote: true,
          },
        },
        media: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
  }

  /** Soft deletes a message, keeping the row but clearing its ciphertext. */
  softDeleteMessage(messageId: string) {
    return this.prisma.chatMessage.update({
      where: {
        id: messageId,
      },
      data: {
        ciphertext: '',
        encryptionMeta: Prisma.JsonNull,
        status: 'DELETED',
        deletedAt: new Date(),
      },
    });
  }

  /** Stores a custom game-community emote's final asset metadata. */
  createGameChatEmote(params: {
    gameId: string;
    createdById: string;
    shortcode: string;
    unicode?: string;
    imageUrl?: string;
    animationUrl?: string;
    width?: number;
    height?: number;
    fileSize?: number;
    mimeType?: string;
  }) {
    return this.prisma.chatEmote.create({
      data: {
        scope: 'GAME',
        gameId: params.gameId,
        createdById: params.createdById,
        shortcode: params.shortcode,
        unicode: params.unicode,
        imageUrl: params.imageUrl,
        animationUrl: params.animationUrl,
        width: params.width,
        height: params.height,
        fileSize: params.fileSize,
        mimeType: params.mimeType,
      },
    });
  }

  /** Finds an emote the user may use: global, or from a game community they belong to. */
  findUsableChatEmote(emoteId: string, userId: string) {
    return this.prisma.chatEmote.findFirst({
      where: {
        id: emoteId,
        deletedAt: null,
        OR: [
          { scope: 'GLOBAL' },
          {
            scope: 'GAME',
            game: {
              members: {
                some: {
                  userId,
                },
              },
            },
          },
        ],
      },
    });
  }

  /** Creates or replaces a user's reaction; unicode stores emoji text, custom emotes use emoteId, and updating clears the other. */
  upsertMessageReaction(params: {
    messageId: string;
    userId: string;
    emoji: string | null;
    emoteId: string | null;
  }) {
    return this.prisma.chatMessageReaction.upsert({
      where: {
        messageId_userId: {
          messageId: params.messageId,
          userId: params.userId,
        },
      },
      create: {
        messageId: params.messageId,
        userId: params.userId,
        emoji: params.emoji,
        emoteId: params.emoteId,
      },
      update: {
        emoji: params.emoji,
        emoteId: params.emoteId,
      },
      include: {
        emote: true,
      },
    });
  }

  /** Removes a user's reaction; deleteMany makes a missing one a count-0 no-op. */
  deleteMessageReaction(messageId: string, userId: string) {
    return this.prisma.chatMessageReaction.deleteMany({
      where: {
        messageId,
        userId,
      },
    });
  }

  /** Updates notification level and mute expiry for one participant. */
  updateParticipantNotificationLevel(
    conversationId: string,
    userId: string,
    notificationLevel: 'ALL' | 'NOTHING',
    mutedUntil: Date | null,
  ) {
    return this.prisma.chatParticipant.update({
      where: {
        conversationId_userId: {
          conversationId,
          userId,
        },
      },
      data: {
        notificationLevel,
        mutedUntil,
      },
    });
  }

  /** Updates pinnedAt for one user's participant row. */
  updateParticipantPinnedAt(
    conversationId: string,
    userId: string,
    pinnedAt: Date | null,
  ) {
    return this.prisma.chatParticipant.update({
      where: {
        conversationId_userId: {
          conversationId,
          userId,
        },
      },
      data: {
        pinnedAt,
      },
    });
  }

  /** Archives or unarchives one user's participant row. */
  async updateParticipantArchivedState(
    conversationId: string,
    userId: string,
    archived: boolean,
  ) {
    // Each direction only leaves its own state (ACTIVE to archive, ARCHIVED to unarchive) so a PENDING request cannot be archived into ACTIVE.
    await this.prisma.chatParticipant.updateMany({
      where: {
        conversationId,
        userId,
        state: archived ? 'ACTIVE' : 'ARCHIVED',
      },
      data: {
        state: archived ? 'ARCHIVED' : 'ACTIVE',
        archivedAt: archived ? new Date() : null,
      },
    });

    return this.prisma.chatParticipant.findUniqueOrThrow({
      where: {
        conversationId_userId: {
          conversationId,
          userId,
        },
      },
    });
  }

  /** Soft deletes a conversation for one participant only. */
  softDeleteConversationForParticipant(conversationId: string, userId: string) {
    return this.prisma.chatParticipant.update({
      where: {
        conversationId_userId: {
          conversationId,
          userId,
        },
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  /** Clears deletedAt for the given participants when a new message reaches them. */
  restoreDeletedParticipants(conversationId: string, userIds: string[]) {
    return this.prisma.chatParticipant.updateMany({
      where: {
        conversationId,
        userId: { in: userIds },
      },
      data: {
        deletedAt: null,
      },
    });
  }
}
