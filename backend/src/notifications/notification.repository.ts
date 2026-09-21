import { Injectable } from '@nestjs/common';

import {
  NotificationEntityType,
  NotificationType,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: {
    recipientId: string;
    actorId?: string | null;
    type: NotificationType;
    entityType: NotificationEntityType;
    entityId: string;
  }) {
    return this.prisma.notification.create({
      data,
    });
  }

  findRecipientById(recipientId: string) {
    return this.prisma.user.findUnique({
      where: {
        id: recipientId,
      },
      select: {
        id: true,
        status: true,
      },
    });
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

  findExisting(params: {
    recipientId: string;
    actorId?: string | null;
    type: NotificationType;
    entityType: NotificationEntityType;
    entityId: string;
    since: Date;
  }) {
    const { recipientId, actorId, type, entityType, entityId, since } = params;

    return this.prisma.notification.findFirst({
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
