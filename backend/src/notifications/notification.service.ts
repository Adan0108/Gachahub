import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  NotificationEntityType,
  NotificationType,
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
   * - Short-term duplicate prevention
   *
   * Returns an existing notification if a recent duplicate is found.
   * Returns null when the actor and recipient are the same user.
   */
  async createNotification(input: CreateNotificationInput) {
    const { recipientId, actorId, type, entityType, entityId } = input;

    if (!recipientId) {
      throw new BadRequestException('recipientId is required');
    }

    if (!entityId) {
      throw new BadRequestException('entityId is required');
    }

    /**
     * All notification types currently supported are triggered
     * by another user and therefore require an actor.
     */
    this.validateActor(type, actorId);

    /**
     * Ensure the notification type can target the supplied entity.
     */
    this.validateEntityForType(type, entityType);

    /**
     * Avoid notifications caused by the recipient themselves.
     */
    if (actorId === recipientId) {
      return null;
    }

    /**
     * Temporary duplicate protection.
     *
     * This prevents repeated processing of the same action within
     * a short period. Kafka event IDs will later provide stronger
     * idempotency guarantees.
     */
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

    /**
     * Duplicate processing is not considered an error.
     */
    if (existingNotification) {
      return existingNotification;
    }

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
   * Fetches one additional record to determine whether another
   * page exists.
   */
  async getNotifications(
    recipientId: string,
    params: GetNotificationsQueryDto,
  ) {
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
    return this.notificationRepository.countUnread(recipientId);
  }

  /**
   * Marks a notification as read if it belongs to the recipient.
   *
   * Returns the existing notification when it has already been read.
   * Throws when the notification does not exist or does not belong
   * to the recipient.
   */
  async markAsRead(recipientId: string, notificationId: string) {
    const notification = await this.notificationRepository.findByIdForRecipient(
      notificationId,
      recipientId,
    );

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    /**
     * Mark-as-read is intentionally idempotent.
     */
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
   * Marks all unread notifications for a recipient as read.
   */
  async markAllAsRead(recipientId: string) {
    const readAt = new Date();

    return this.notificationRepository.markAllAsRead({
      recipientId,
      readAt,
    });
  }

  /**
   * Ensures notification types triggered by user actions have an actor.
   *
   * All currently supported notification types require an actor.
   * This can be extended later for system or moderation notifications.
   */
  private validateActor(type: NotificationType, actorId?: string | null) {
    if (!actorId) {
      throw new BadRequestException(`actorId is required for ${type}`);
    }
  }

  /**
   * Ensures that each notification type targets a compatible entity.
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
    }
  }
}
