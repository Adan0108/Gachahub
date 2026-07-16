import { Injectable } from '@nestjs/common';
import {
  ChatMessageContentType,
  ChatParticipantState,
  Prisma,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type PrismaTransaction = Parameters<
  Parameters<PrismaService['$transaction']>[0]
>[0];

@Injectable()
export class ChatRepository {
  constructor(private readonly prisma: PrismaService) {}

  findUserById(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
    });
  }

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
      },
    });
  }

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

  findParticipants(conversationId: string) {
    return this.prisma.chatParticipant.findMany({
      where: { conversationId },
    });
  }

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
      },
    });
  }

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
      },
    });
  }

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
}
