import { Injectable } from '@nestjs/common';
import {
  ChatMessageContentType,
  ChatParticipantState,
  ChatMessageReactionType,
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
   * Finds any global chat block between two users.
   *
   * Used before sending so either user's block stops direct messaging.
   */
  findAnyUserBlock(userIdA: string, userIdB: string) {
    return this.prisma.chatUserBlock.findFirst({
      where: {
        OR: [
          {
            blockerId: userIdA,
            blockedId: userIdB,
          },
          {
            blockerId: userIdB,
            blockedId: userIdA,
          },
        ],
      },
    });
  }

  /**
   * Creates a global user block for chat.
   *
   * Upsert makes blocking idempotent if the caller taps block more than once.
   */
  blockUser(blockerId: string, blockedId: string) {
    return this.prisma.chatUserBlock.upsert({
      where: {
        blockerId_blockedId: {
          blockerId,
          blockedId,
        },
      },
      create: {
        blockerId,
        blockedId,
      },
      update: {},
    });
  }

  /**
   * Removes a global user block created by the caller.
   *
   * deleteMany keeps unblock idempotent when no block row exists.
   */
  unblockUser(blockerId: string, blockedId: string) {
    return this.prisma.chatUserBlock.deleteMany({
      where: {
        blockerId,
        blockedId,
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
   * prevents dupe message when a client retries after a network
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
   * Counts unread messages for a user in one convo.
   *
   * Sender's own messages are excluded bc users should not count their own
   * messages as unread.
   */
  countUnreadMessages(conversationId: string, userId: string) {
    return this.prisma.chatMessage.count({
      where: {
        conversationId,
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
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        receipts: true,
        reactions: true,
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
            orderBy: {
              createdAt: 'desc',
            },
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
            createdAt: {
              lte: lastReadMessage.createdAt,
            },
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
        reactions: true,
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
   * Creates or replaces a user's reaction on a message.
   *
   * The database unique key on messageId + userId enforces one reaction per user
   * per message.
   */
  upsertMessageReaction(params: {
    messageId: string;
    userId: string;
    type: ChatMessageReactionType;
  }) {
    return this.prisma.chatMessageReaction.upsert({
      where: {
        messageId_userId: {
          messageId: params.messageId,
          userId: params.userId,
        },
      },
      create: params,
      update: {
        type: params.type,
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
   * Updates the current user's mute timestamp for a conversation.
   *
   * This is per participant so mute/unmute does not affect the other user.
   */
  updateParticipantMutedAt(
    conversationId: string,
    userId: string,
    mutedAt: Date | null,
  ) {
    return this.prisma.chatParticipant.update({
      where: {
        conversationId_userId: {
          conversationId,
          userId,
        },
      },
      data: {
        mutedAt,
      },
    });
  }

  /**
   * Archives or unarchives one user's participant row.
   *
   * Archive is per-user. It hides the convo for this user without deleting
   * messages or affecting the other participant.
   */
  updateParticipantArchivedState(
    conversationId: string,
    userId: string,
    archived: boolean,
  ) {
    return this.prisma.chatParticipant.update({
      where: {
        conversationId_userId: {
          conversationId,
          userId,
        },
      },
      data: {
        state: archived ? 'ARCHIVED' : 'ACTIVE',
        archivedAt: archived ? new Date() : null,
      },
    });
  }
}
