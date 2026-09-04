import { Injectable } from '@nestjs/common';
import {
  ChatMessageContentType,
  ChatParticipantRole,
  ChatParticipantState,
  Prisma,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type PrismaTransaction = Parameters<
  Parameters<PrismaService['$transaction']>[0]
>[0];

/**
 * Repository responsible for chat database queries.
 *
 * This layer should only contain Prisma/database logic. Business decisions,
 * permission checks, and delivery behavior belong in ChatService.
 */
@Injectable()
export class ChatRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Finds a user by id
   *
   * Used before creating a direct convo to ensure the
   * user/recipient exists and can receive messages
   */
  findUserById(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
    });
  }

  /**
   * Finds active users by id list.
   *
   * Used before adding group members so inactive or missing accounts are not
   * inserted as active chat participants.
   */
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

  /**
   * Finds the unique direct-pair record for two users.
   *
   * Direct pair ids are normalized before calling this method,
   * A->B and B->A ==> point to the same conversation.
   */
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

  /**
   * Finds a message by sender and client idempotency key.
   *
   * prevents duplicate messages when a client retries after a network
   * timeout but the original request already succeeded.
   */
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
      },
    });
  }

  /**
   * Finds one participant row in a conversation.
   *
   * Participant state is main source of truth for read/send/block/request permissions.
   */
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

  /**
   * List all participants in a convo
   *
   * Used when creating message receipts and
   * deciding who should receive delivery events.
   */
  findParticipants(conversationId: string) {
    return this.prisma.chatParticipant.findMany({
      where: { conversationId },
    });
  }

  /**
   * Creates new direct convo and its first message.
   *
   * This uses a transaction so conversation, direct pair, participants, message,
   * receipts, and lastMessageId stay consistent.
   */
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

  /**
   * Creates a group conversation and participant rows.
   *
   * The creator becomes OWNER and is always ACTIVE. Other
   * member's state is resolved by the called (ChatService)
   * based on mutual follow-mutual followers start ACTIVE,
   * everyone else starts PENDING pending their accept.
   */
  createGroupConversation(params: {
    creatorId: string;
    title: string;
    photoUrl?: string;
    members: Array<{ userId: string; state: 'ACTIVE' | 'PENDING' }>;
  }) {
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
            })),
          ],
        },
      },
      include: {
        participants: true,
      },
    });
  }

  /**
   * Updates group conversation metadata.
   *
   * Permission checks stay in ChatService.
   */
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

  /**
   * Add or reactivates member rows for a group.
   *
   * skip BLOCKED rows, clears deletedAt/archivedAt and resets role to MEMBER when reactivating.
   */
  async addGroupMembers(
    conversationId: string,
    members: Array<{ userId: string; state: 'ACTIVE' | 'PENDING' }>,
  ) {
    const memberIdsByState = new Map<'ACTIVE' | 'PENDING', string[]>();

    for (const member of members) {
      const userIds = memberIdsByState.get(member.state) ?? [];
      userIds.push(member.userId);
      memberIdsByState.set(member.state, userIds);
    }

    return this.prisma.$transaction(async (tx) => {
      for (const [state, userIds] of memberIdsByState) {
        await tx.chatParticipant.updateMany({
          where: {
            conversationId,
            userId: { in: userIds },
            role: {
              not: 'OWNER',
            },
            state: {
              not: 'BLOCKED',
            },
          },
          data: {
            state,
            role: 'MEMBER',
            deletedAt: null,
            archivedAt: null,
          },
        });
      }

      return tx.chatParticipant.createMany({
        data: members.map((member) => ({
          conversationId,
          userId: member.userId,
          role: 'MEMBER',
          state: member.state,
        })),
        skipDuplicates: true,
      });
    });
  }

  /**
   * Marks group members as declined/removed.
   *
   * OWNER participants are excluded so a group cannot lose ownership here.
   */
  removeGroupMembers(conversationId: string, userIds: string[]) {
    return this.prisma.chatParticipant.updateMany({
      where: {
        conversationId,
        userId: {
          in: userIds,
        },
        role: {
          not: 'OWNER',
        },
      },
      data: {
        state: 'DECLINED',
      },
    });
  }

  /**
   * Swaps OWNER between two participants in one transaction.
   *
   * Both updates happen together so the group is never
   * briefly ownerless or briefly has two owner
   */
  transferGroupOwnership(
    conversationId: string,
    currentOwnerUserId: string,
    newOwnerUserId: string,
  ) {
    return this.prisma.$transaction([
      this.prisma.chatParticipant.update({
        where: {
          conversationId_userId: {
            conversationId,
            userId: currentOwnerUserId,
          },
        },
        data: { role: 'ADMIN' },
      }),
      this.prisma.chatParticipant.update({
        where: {
          conversationId_userId: {
            conversationId,
            userId: newOwnerUserId,
          },
        },
        data: { role: 'OWNER' },
      }),
    ]);
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

  /**
   * Finds a conversation with participants for group permission checks.
   */
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

  /**
   * Finds a conversation's type only.
   *
   * Used to gate group invite previews away from full message history.
   */
  findConversationType(conversationId: string) {
    return this.prisma.chatConversation.findUnique({
      where: { id: conversationId },
      select: { type: true },
    });
  }

  /**
   * Creates an encrypted message inside an existing conversation.
   *
   * The transaction keeps the message and conversation lastMessageId update in sync.
   */
  async createMessage(params: {
    conversationId: string;
    senderId: string;
    participantUserIds: string[];
    ciphertext: string;
    encryptionMeta?: Prisma.InputJsonValue;
    contentType?: ChatMessageContentType;
    clientMessageId?: string;
    replyToId?: string;
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

  /**
   * Shared transaction helper for inserting chat msg.
   *
   * Sender receipts are marked delivered/read immediately bc the sender's
   * client created the message. Other participants start undelivered/unread.
   */
  private createMessageInTransaction(
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
    },
  ) {
    const now = new Date();

    return tx.chatMessage.create({
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
  }

  /**
   * Finds convos for one inbox state.
   *
   * ACTIVE powers the normal inbox. PENDING powers the stranger request inbox.
   * The latest encrypted message is included for client-side preview.
   */
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

  /**
   * Counts unread messages across many conversations in one query.
   */
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

  /**
   * Counts all unread messages for one user's accepted inbox.
   *
   * Sender messages are excluded, and pending stranger requests are ignored so
   * the normal chat badge only counts accepted conversations.
   */
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

  /**
   * Counts accepted conversations with at least one unread message.
   *
   * This lets the frontend show "how many chats are unread" without loading
   * the full inbox list.
   */
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

  /**
   * Finds encrypted messages with cursor pagination.
   *
   * Results are queried newest-first for efficient pagination.
   * ChatService reverses them before returning to the client.
   */
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

  /**
   * Updates a user's participant state in a conversation.
   *
   * State-specific timestamps are stored here so future safety/audit features-
   * can tell when a user blocked or archived a chat.
   */
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
        blockedAt: state === 'BLOCKED' ? now : undefined,
        archivedAt: state === 'ARCHIVED' ? now : undefined,
      },
    });
  }

  /**
   * Marks selected message receipts as delivered for a user.
   *
   * Only empty deliveredAt values are updated so repeated sync calls are safe
   */
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

  /**
   * Marks all messages up to a point as read for a user
   *
   * If lastReadMessageId is omitted, the latest current message is used
   * The participant lastReadAt timestamp is updated in the same transaction
   */
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

  /**
   * Find message and its conversation participants
   *
   * Used by reaction logic because message-level actions still need
   * conversation-level permission checks.
   */
  findMessageWithParticipants(messageId: string) {
    return this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      include: {
        conversation: {
          include: {
            participants: true,
          },
        },
      },
    });
  }

  /**
   * Updates an existing encrypted message payload.
   *
   * Used for message edit. The service checks ownership and permissions before
   * calling this database method.
   */
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
      },
    });
  }

  /**
   * Soft deletes a message.
   *
   * The row is kept for audit/reply/history consistency, but ciphertext is
   * cleared so deleted encrypted content is no longer retained.
   */
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

  /**
   * Creates a custom emote for a game community.
   *
   * Upload/crop/edit happens before this call; this stores the final asset
   * metadata so the upload provider can be replaced later.
   */
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

  /**
   * Finds an emote the user is allowed to use.
   *
   * Global emotes are available to everyone. Game emotes require membership in
   * the owning game community.
   */
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

  /**
   * Creates or replaces a user's reaction on a message.
   *
   * Unicode emoji reactions store raw emoji text. Custom image/gif emotes point
   * to ChatEmote through emoteId. Updating one clears the other.
   */
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

  /**
   * Remove current user's reaction from a message.
   *
   * deleteMany keeps the operation idempotent: removing a missing reaction
   * simply returns count 0 instead of throwing
   */
  deleteMessageReaction(messageId: string, userId: string) {
    return this.prisma.chatMessageReaction.deleteMany({
      where: {
        messageId,
        userId,
      },
    });
  }

  /**
   * Updates notification level and mute expiry for one participant
   */
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

  /**
   * Updates pinnedAt for one user's participant row.
   *
   * Pinning is per-user inbox state. One user pinning a conversation does not
   * change the other participant's inbox.
   */
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

  /**
   * Archives or unarchives one user's participant row.
   *
   * Archive is per-user. It hides the convo for this user without deleting
   * messages or affecting the other participant.
   */
  async updateParticipantArchivedState(
    conversationId: string,
    userId: string,
    archived: boolean,
  ) {
    // Both directions are scoped to the state they are allowed to leave: only ACTIVE
    // rows archive, only ARCHIVED rows unarchive. That keeps PENDING out of the archive
    // cycle entirely, so a pending message request cannot be laundered into ACTIVE by
    // archiving and then unarchiving. Accepting a request stays a separate transition.
    // Scoping the write rather than filtering in the caller keeps a rejected or repeated
    // call a harmless no-op instead of an error.
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

  /**
   * Soft deletes a conversation for one participant only.
   *
   * "Delete for me": clears this participant's row from every inbox query,
   * but leaves the other participant's copy and the underlying messages and
   * receipts untouched.
   */
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

  /**
   * Clears deletedAt for the given participants.
   *
   * Resurface trigger: called whenever a new message is delivered to someone
   * (sender or recipient) who had previously deleted the conversation for themselves.
   */
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
