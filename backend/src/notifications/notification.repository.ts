import { Injectable } from '@nestjs/common';

import {
  NotificationEntityType,
  NotificationType,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../generated/prisma/client';

@Injectable()
export class NotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    data: {
      recipientId: string;
      actorId?: string | null;
      type: NotificationType;
      entityType: NotificationEntityType;
      entityId: string;
    },
    transaction?: Prisma.TransactionClient,
  ) {
    const db = transaction ?? this.prisma;

    return db.notification.create({
      data,
    });
  }

  findRecipientById(
    recipientId: string,
    transaction?: Prisma.TransactionClient,
  ) {
    const db = transaction ?? this.prisma;

    return db.user.findUnique({
      where: {
        id: recipientId,
      },
      select: {
        id: true,
        status: true,
      },
    });
  }

  /** Batch counterpart to findRecipientById: which of these ids belong to a live, notifiable account. */
  findNotifiableRecipientIds(
    recipientIds: readonly string[],
    transaction?: Prisma.TransactionClient,
  ): Promise<string[]> {
    const db = transaction ?? this.prisma;

    return db.user
      .findMany({
        where: {
          id: { in: [...recipientIds] },
          status: { notIn: ['DELETED', 'BANNED'] },
        },
        select: { id: true },
      })
      .then((rows) => rows.map((row) => row.id));
  }

  /** Batch counterpart to create: one insert for many notifications sharing actor/type/entity, one recipient each. Caller supplies `id` so it can return the rows itself, no read-back. */
  createMany(
    data: Array<{
      id: string;
      recipientId: string;
      actorId?: string | null;
      type: NotificationType;
      entityType: NotificationEntityType;
      entityId: string;
    }>,
    transaction?: Prisma.TransactionClient,
  ) {
    const db = transaction ?? this.prisma;

    return db.notification.createMany({ data, skipDuplicates: true });
  }

  findByRecipient(params: {
    recipientId: string;
    limit: number;
    cursor?: string;
  }) {
    const { recipientId, limit, cursor } = params;

    return this.prisma.notification.findMany({
      where: {
        recipientId,
      },
      include: {
        actor: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
      orderBy: [
        {
          createdAt: 'desc',
        },
        {
          id: 'desc',
        },
      ],
      take: limit,

      ...(cursor
        ? {
            cursor: {
              id: cursor,
            },
            skip: 1,
          }
        : {}),
    });
  }

  findByIdForRecipient(notificationId: string, recipientId: string) {
    return this.prisma.notification.findFirst({
      where: {
        id: notificationId,
        recipientId,
      },
    });
  }

  countUnread(recipientId: string) {
    return this.prisma.notification.count({
      where: {
        recipientId,
        readAt: null,
      },
    });
  }

  markAsRead(params: {
    notificationId: string;
    recipientId: string;
    readAt: Date;
  }) {
    const { notificationId, recipientId, readAt } = params;

    return this.prisma.notification.updateMany({
      where: {
        id: notificationId,
        recipientId,
        readAt: null,
      },
      data: {
        readAt,
      },
    });
  }

  /**
   * Marks a recipient's unread chat message notifications read when the message no longer needs
   * them: it was read (the notification can be saved just after the read lands), or it was
   * unsent or is gone. The receipts are the truth for what is read, so this brings the bell back
   * in line with them whatever path left a notification behind. Returns how many it settled.
   */
  settleMessageNotifications(recipientId: string): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE notifications n
      SET "readAt" = COALESCE(
            (SELECT r."readAt" FROM chat_message_receipts r
              WHERE r."messageId" = n."entityId" AND r."userId" = n."recipientId"),
            NOW()
          ),
          "updatedAt" = NOW()
      WHERE n."recipientId" = ${recipientId}
        AND n."readAt" IS NULL
        AND n."entityType" = 'MESSAGE'
        AND n."type" IN ('MESSAGE_RECEIVED', 'MESSAGE_REPLIED')
        AND (
          EXISTS (
            SELECT 1 FROM chat_message_receipts r
            WHERE r."messageId" = n."entityId"
              AND r."userId" = n."recipientId"
              AND r."readAt" IS NOT NULL
          )
          OR NOT EXISTS (
            SELECT 1 FROM chat_messages m
            WHERE m.id = n."entityId" AND m.status = 'SENT'
          )
        )
    `;
  }

  /** The conversation each of these messages is in, so a chat notification can open it. */
  async findConversationIdsByMessageIds(
    messageIds: string[],
  ): Promise<Array<{ id: string; conversationId: string }>> {
    if (messageIds.length === 0) {
      return [];
    }

    return this.prisma.chatMessage.findMany({
      where: { id: { in: messageIds } },
      select: { id: true, conversationId: true },
    });
  }

  /** Marks a recipient's chat message notifications for these messages read. */
  markMessageNotificationsAsRead(params: {
    recipientId: string;
    messageIds: string[];
    readAt: Date;
  }) {
    const { recipientId, messageIds, readAt } = params;

    return this.prisma.notification.updateMany({
      where: {
        recipientId,
        type: { in: ['MESSAGE_RECEIVED', 'MESSAGE_REPLIED'] },
        entityType: 'MESSAGE',
        entityId: { in: messageIds },
        readAt: null,
      },
      data: { readAt },
    });
  }

  markAllAsRead(params: { recipientId: string; readAt: Date }) {
    const { recipientId, readAt } = params;

    return this.prisma.notification.updateMany({
      where: {
        recipientId,
        readAt: null,
      },
      data: {
        readAt,
      },
    });
  }

  findExisting(
    params: {
      recipientId: string;
      actorId?: string | null;
      type: NotificationType;
      entityType: NotificationEntityType;
      entityId: string;
      since: Date;
    },
    transaction?: Prisma.TransactionClient,
  ) {
    const { recipientId, actorId, type, entityType, entityId, since } = params;

    const db = transaction ?? this.prisma;

    return db.notification.findFirst({
      where: {
        recipientId,
        actorId: actorId ?? null,
        type,
        entityType,
        entityId,
        createdAt: {
          gte: since,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
