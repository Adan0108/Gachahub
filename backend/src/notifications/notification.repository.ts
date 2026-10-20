import { Injectable } from '@nestjs/common';

import {
  NotificationEntityType,
  NotificationType,
  type Notification,
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
      conversationId?: string | null;
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
    /** Notifications left out of the list, such as chat messages this device could never read. */
    excludeIds?: string[];
  }) {
    const { recipientId, limit, cursor, excludeIds } = params;

    return this.prisma.notification.findMany({
      where: {
        recipientId,
        ...(excludeIds?.length ? { id: { notIn: excludeIds } } : {}),
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

  countUnread(recipientId: string, excludeIds?: string[]) {
    return this.prisma.notification.count({
      where: {
        recipientId,
        readAt: null,
        ...(excludeIds?.length ? { id: { notIn: excludeIds } } : {}),
      },
    });
  }

  /** When the chat device behind this login was registered; null when the login has no active device. */
  async findDeviceStart(
    sessionId: string,
    userId: string,
  ): Promise<Date | null> {
    const rows = await this.prisma.$queryRaw<Array<{ createdAt: Date }>>`
      SELECT d."createdAt"
      FROM session s
      JOIN chat_devices d ON d.id = s."chatDeviceId"
      WHERE s.id = ${sessionId}
        AND s."userId" = ${userId}
        AND d."revokedAt" IS NULL
    `;

    return rows[0]?.createdAt ?? null;
  }

  /** This person's chat message notifications for messages sent before `since`: ones a device registered at `since` can never read. */
  async findMessageNotificationIdsBefore(
    recipientId: string,
    since: Date,
  ): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT n.id
      FROM notifications n
      JOIN chat_messages m ON m.id = n."entityId"
      WHERE n."recipientId" = ${recipientId}
        AND n."entityType" = 'MESSAGE'
        AND n."type" IN ('MESSAGE_RECEIVED', 'MESSAGE_REPLIED')
        AND m."createdAt" < ${since}
    `;

    return rows.map((row) => row.id);
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

  /**
   * One unread "sent you messages" row per person and conversation: a new message opens it, and
   * every later one while it is unread only bumps its count, latest message and time. The partial
   * unique index makes that safe when two messages arrive together. Returns the rows as they now are.
   */
  upsertMessageStack(
    params: {
      recipientIds: string[];
      actorId: string;
      messageId: string;
      conversationId: string;
    },
    transaction: Prisma.TransactionClient,
  ) {
    const { recipientIds, actorId, messageId, conversationId } = params;

    return transaction.$queryRaw<Notification[]>`
      INSERT INTO notifications
        (id, "recipientId", "actorId", "type", "entityType", "entityId", "conversationId", "count", "createdAt", "updatedAt")
      SELECT gen_random_uuid()::text, recipient, ${actorId}, 'MESSAGE_RECEIVED'::"NotificationType",
             'MESSAGE'::"NotificationEntityType", ${messageId}, ${conversationId}, 1, now(), now()
      FROM unnest(${recipientIds}::text[]) AS recipient
      ON CONFLICT ("recipientId", "conversationId")
        WHERE "type" = 'MESSAGE_RECEIVED' AND "readAt" IS NULL AND "conversationId" IS NOT NULL
      DO UPDATE SET
        "count" = notifications."count" + 1,
        "entityId" = EXCLUDED."entityId",
        "actorId" = EXCLUDED."actorId",
        "createdAt" = now(),
        "updatedAt" = now()
      RETURNING *
    `;
  }

  /** The kind and name of these conversations, so a chat notification can say where it is from. */
  findConversationSummaries(conversationIds: string[]): Promise<
    Array<{
      id: string;
      type: string;
      title: string | null;
      photoUrl: string | null;
    }>
  > {
    if (conversationIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.prisma.chatConversation.findMany({
      where: { id: { in: conversationIds } },
      select: { id: true, type: true, title: true, photoUrl: true },
    });
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
