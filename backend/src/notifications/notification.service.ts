import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  NotificationEntityType,
  NotificationType,
  UserStatus,
} from '../generated/prisma/client';

import { GetNotificationsQueryDto } from './dto/get-notifications-query.dto';
import { NotificationRepository } from './notification.repository';
import { CreateNotificationInput } from './notification.types';

@Injectable()
export class NotificationService {
  private static readonly DEFAULT_PAGE_SIZE = 20;
  private static readonly DEDUPE_WINDOW_MS = 60_000;

  constructor(
    private readonly notificationRepository: NotificationRepository,
  ) {}

  /**
   * Creates a notification for a recipient.
   *
   * Handles:
   * - Runtime input validation
   * - Actor validation
   * - Notification type/entity validation
   * - Self-notification prevention
   * - Recipient availability validation
   * - Short-term duplicate prevention
   *
   * Returns:
   * - The newly created notification
   * - An existing recent duplicate
   * - null when notification should be skipped
   */
  async createNotification(input: CreateNotificationInput) {
    const { recipientId, actorId, type, entityType, entityId } = input;

    // 1. Basic runtime validation.
    if (!recipientId) {
      throw new BadRequestException('recipientId is required');
    }

    if (!entityId) {
      throw new BadRequestException('entityId is required');
    }

    if (!type) {
      throw new BadRequestException('type is required');
    }

    if (!entityType) {
      throw new BadRequestException('entityType is required');
    }

    // 2. All currently supported notification types require an actor.
    this.validateActor(type, actorId);

    // 3. Validate type -> entity compatibility.
    this.validateEntityForType(type, entityType);

    // 4. Do not notify users about their own actions.
    if (actorId === recipientId) {
      return null;
    }

    // 5. Ensure recipient still exists.
    //
    // This becomes particularly important once notifications are created
    // asynchronously through Kafka because the recipient may disappear
    // between event publication and event consumption.
    const recipient =
      await this.notificationRepository.findRecipientById(recipientId);

    if (!recipient) {
      return null;
    }

    // Deleted/banned accounts should not receive new notifications.
    if (
      recipient.status === UserStatus.DELETED ||
      recipient.status === UserStatus.BANNED
    ) {
      return null;
    }

    // 6. Temporary short-term duplicate protection.
    //
    // Later Kafka event IDs / idempotency handling should become the
    // stronger guarantee against processing the same event multiple times.
    const dedupeSince = new Date(
      Date.now() - NotificationService.DEDUPE_WINDOW_MS,
    );

    const existingNotification = await this.notificationRepository.findExisting(
      {
        recipientId,
        actorId,
        type,
        entityType,
        entityId,
        since: dedupeSince,
      },
    );

    // Duplicate processing is not considered an error.
    if (existingNotification) {
      return existingNotification;
    }

    // 7. Persist the notification.
    return this.notificationRepository.create({
      recipientId,
      actorId,
      type,
      entityType,
      entityId,
    });
  }

  /**
   * Returns a cursor-paginated list of notifications for a recipient.
   *
   * Fetches one additional row to determine whether another page exists.
   */
  async getNotifications(
    recipientId: string,
    params: GetNotificationsQueryDto,
  ) {
    if (!recipientId) {
      throw new BadRequestException('recipientId is required');
    }

    const limit = params.limit ?? NotificationService.DEFAULT_PAGE_SIZE;
    const cursor = params.cursor;

    const notifications = await this.notificationRepository.findByRecipient({
      recipientId,
      limit: limit + 1,
      cursor,
    });

    const hasMore = notifications.length > limit;

    const items = hasMore ? notifications.slice(0, limit) : notifications;

    const nextCursor =
      hasMore && items.length > 0 ? items[items.length - 1].id : null;

    return {
      items,
      nextCursor,
      hasMore,
    };
  }

  /**
   * Returns the number of unread notifications for a recipient.
   */
  async getUnreadCount(recipientId: string) {
    if (!recipientId) {
      throw new BadRequestException('recipientId is required');
    }

    const count = await this.notificationRepository.countUnread(recipientId);

    return {
      count,
    };
  }

  /**
   * Marks one notification as read.
   *
   * The notification must belong to the supplied recipient.
   *
   * This operation is intentionally idempotent.
   */
  async markAsRead(recipientId: string, notificationId: string) {
    if (!recipientId) {
      throw new BadRequestException('recipientId is required');
    }

    if (!notificationId) {
      throw new BadRequestException('notificationId is required');
    }

    const notification = await this.notificationRepository.findByIdForRecipient(
      notificationId,
      recipientId,
    );

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    // Already read -> successful no-op.
    if (notification.readAt) {
      return notification;
    }

    const readAt = new Date();

    await this.notificationRepository.markAsRead({
      notificationId,
      recipientId,
      readAt,
    });

    return {
      ...notification,
      readAt,
    };
  }

  /**
   * Marks all currently unread notifications for a recipient as read.
   */
  async markAllAsRead(recipientId: string) {
    if (!recipientId) {
      throw new BadRequestException('recipientId is required');
    }

    const readAt = new Date();

    const result = await this.notificationRepository.markAllAsRead({
      recipientId,
      readAt,
    });

    return {
      updatedCount: result.count,
      readAt,
    };
  }

  /**
   * All currently supported notification types are caused by another user.
   *
   * This can later be relaxed for system/moderation notifications.
   */
  private validateActor(type: NotificationType, actorId?: string | null) {
    if (!actorId) {
      throw new BadRequestException(`actorId is required for ${type}`);
    }
  }

  /**
   * Ensures that a notification type targets a compatible entity.
   */
  private validateEntityForType(
    type: NotificationType,
    entityType: NotificationEntityType,
  ) {
    switch (type) {
      case NotificationType.POST_LIKED:
        if (entityType !== NotificationEntityType.POST) {
          throw new BadRequestException('POST_LIKED must target a POST');
        }
        return;

      case NotificationType.POST_COMMENTED:
      case NotificationType.COMMENT_REPLIED:
        if (entityType !== NotificationEntityType.COMMENT) {
          throw new BadRequestException(`${type} must target a COMMENT`);
        }
        return;

      case NotificationType.USER_FOLLOWED:
        if (entityType !== NotificationEntityType.USER) {
          throw new BadRequestException('USER_FOLLOWED must target a USER');
        }
        return;

      case NotificationType.USER_MENTIONED:
        if (
          entityType !== NotificationEntityType.POST &&
          entityType !== NotificationEntityType.COMMENT &&
          entityType !== NotificationEntityType.MESSAGE
        ) {
          throw new BadRequestException(
            'USER_MENTIONED must target a POST, COMMENT, or MESSAGE',
          );
        }
        return;

      case NotificationType.MESSAGE_RECEIVED:
      case NotificationType.MESSAGE_REPLIED:
        if (entityType !== NotificationEntityType.MESSAGE) {
          throw new BadRequestException(`${type} must target a MESSAGE`);
        }
        return;

      case NotificationType.GROUP_ADDED:
      case NotificationType.GROUP_INVITE_PENDING:
        if (entityType !== NotificationEntityType.CONVERSATION) {
          throw new BadRequestException(`${type} must target a CONVERSATION`);
        }
        return;

      default:
        // Do not interpolate `type` here.
        //
        // TypeScript considers this branch unreachable for the current
        // exhaustive NotificationType enum, so `type` is narrowed to
        // `never`, which triggers restrict-template-expressions.
        throw new BadRequestException('Unsupported notification type');
    }
  }
}
