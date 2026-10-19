import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import {
  NotificationEntityType,
  NotificationType,
  UserStatus,
  type Prisma,
} from '../generated/prisma/client';

import { CommentsRepository } from '../comments/comments.repository';
import { GetNotificationsQueryDto } from './dto/get-notifications-query.dto';
import {
  commentEntityIds,
  messageEntityIds,
  withConversationIds,
  withConversations,
  withPostIds,
} from './notification.mapper';
import { NotificationRepository } from './notification.repository';
import { CreateNotificationInput } from './notification.types';

@Injectable()
export class NotificationService {
  private static readonly DEFAULT_PAGE_SIZE = 20;
  private static readonly DEDUPE_WINDOW_MS = 60_000;
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly commentsRepository: CommentsRepository,
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
  async createNotification(
    input: CreateNotificationInput,
    transaction?: Prisma.TransactionClient,
  ) {
    const { recipientId, actorId, type, entityType, entityId, conversationId } =
      input;

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
    const recipient = await this.notificationRepository.findRecipientById(
      recipientId,
      transaction,
    );
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
      transaction,
    );

    // Duplicate processing is not considered an error.
    if (existingNotification) {
      return existingNotification;
    }

    // 7. Persist the notification.
    return this.notificationRepository.create(
      {
        recipientId,
        actorId,
        type,
        entityType,
        entityId,
        conversationId,
      },
      transaction,
    );
  }

  /** Batch counterpart to createNotification for a fan-out (same actor/type/entity, many recipients) - skips the per-recipient dedupe check since entityId is unique per event. */
  async createManyNotifications(
    input: {
      recipientIds: readonly string[];
      actorId: string;
      type: NotificationType;
      entityType: NotificationEntityType;
      entityId: string;
    },
    transaction: Prisma.TransactionClient,
  ): Promise<
    Array<{
      id: string;
      recipientId: string;
      actorId: string | null;
      type: NotificationType;
      entityType: NotificationEntityType;
      entityId: string;
      conversationId: string | null;
      count: number;
      readAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }>
  > {
    this.validateActor(input.type, input.actorId);
    this.validateEntityForType(input.type, input.entityType);

    const candidateIds = input.recipientIds.filter(
      (recipientId) => recipientId !== input.actorId,
    );

    if (candidateIds.length === 0) {
      return [];
    }

    const notifiableIds =
      await this.notificationRepository.findNotifiableRecipientIds(
        candidateIds,
        transaction,
      );

    if (notifiableIds.length === 0) {
      return [];
    }

    const now = new Date();
    // Ids are generated here (not left to the DB default) so the rows below can be returned
    // directly - no read-back needed, and nothing to accidentally over-match on.
    const rows = notifiableIds.map((recipientId) => ({
      id: randomUUID(),
      recipientId,
      actorId: input.actorId,
      type: input.type,
      entityType: input.entityType,
      entityId: input.entityId,
      conversationId: null,
      count: 1,
      readAt: null,
      createdAt: now,
      updatedAt: now,
    }));

    await this.notificationRepository.createMany(rows, transaction);

    return rows;
  }

  /**
   * "Sent you a message" for people in a conversation, stacked: each person has one unread row for
   * the conversation that counts its messages, instead of one row per message. People who cannot
   * be notified (gone or banned) are left out; the sender never notifies themselves.
   */
  async stackMessageNotifications(
    input: {
      recipientIds: readonly string[];
      actorId: string;
      messageId: string;
      conversationId: string;
    },
    transaction: Prisma.TransactionClient,
  ) {
    const candidateIds = input.recipientIds.filter(
      (recipientId) => recipientId !== input.actorId,
    );
    if (candidateIds.length === 0) {
      return [];
    }

    const notifiableIds =
      await this.notificationRepository.findNotifiableRecipientIds(
        candidateIds,
        transaction,
      );
    if (notifiableIds.length === 0) {
      return [];
    }

    return this.notificationRepository.upsertMessageStack(
      {
        recipientIds: notifiableIds,
        actorId: input.actorId,
        messageId: input.messageId,
        conversationId: input.conversationId,
      },
      transaction,
    );
  }

  /**
   * Returns a cursor-paginated list of notifications for a recipient.
   *
   * Fetches one additional row to determine whether another page exists.
   */
  async getNotifications(
    recipientId: string,
    params: GetNotificationsQueryDto,
    sessionId?: string,
  ) {
    if (!recipientId) {
      throw new BadRequestException('recipientId is required');
    }

    await this.settleReadMessageNotifications(recipientId);
    const excludeIds = await this.idsThisDeviceCannotRead(
      recipientId,
      sessionId,
    );

    const limit = params.limit ?? NotificationService.DEFAULT_PAGE_SIZE;
    const cursor = params.cursor;

    const notifications = await this.notificationRepository.findByRecipient({
      recipientId,
      limit: limit + 1,
      cursor,
      excludeIds,
    });

    const hasMore = notifications.length > limit;

    const items = hasMore ? notifications.slice(0, limit) : notifications;

    const nextCursor =
      hasMore && items.length > 0 ? items[items.length - 1].id : null;

    const [comments, messages] = await Promise.all([
      this.commentsRepository.findPostIdsByCommentIds(commentEntityIds(items)),
      // Rows made before a row carried its own conversation find it through the message
      this.notificationRepository.findConversationIdsByMessageIds(
        messageEntityIds(items.filter((item) => !item.conversationId)),
      ),
    ]);

    const located = withConversationIds(
      withPostIds(
        items,
        new Map(comments.map((comment) => [comment.id, comment.postId])),
      ),
      new Map(messages.map((message) => [message.id, message.conversationId])),
    );
    const summaries =
      await this.notificationRepository.findConversationSummaries([
        ...new Set(
          located.flatMap((item) =>
            item.conversationId ? [item.conversationId] : [],
          ),
        ),
      ]);

    return {
      items: withConversations(
        located,
        new Map(summaries.map((summary) => [summary.id, summary])),
      ),
      nextCursor,
      hasMore,
    };
  }

  /**
   * Chat message notifications for messages sent before this login's device existed. That device
   * can never decrypt them, so a new device or a reset one does not light the bell for history it
   * cannot open; the person's other devices still show them.
   */
  private async idsThisDeviceCannotRead(
    recipientId: string,
    sessionId: string | undefined,
  ): Promise<string[]> {
    if (!sessionId) return [];

    try {
      const deviceStart = await this.notificationRepository.findDeviceStart(
        sessionId,
        recipientId,
      );
      if (!deviceStart) return [];

      return await this.notificationRepository.findMessageNotificationIdsBefore(
        recipientId,
        deviceStart,
      );
    } catch (error) {
      this.logger.warn(
        `Could not tell which notifications ${recipientId}'s device cannot read`,
        error,
      );
      return [];
    }
  }

  /** Best effort: a failure here must not stop the bell from answering. */
  private async settleReadMessageNotifications(recipientId: string) {
    try {
      await this.notificationRepository.settleMessageNotifications(recipientId);
    } catch (error) {
      this.logger.warn(
        `Could not settle message notifications for ${recipientId}`,
        error,
      );
    }
  }

  /**
   * Returns the number of unread notifications for a recipient.
   */
  async getUnreadCount(recipientId: string, sessionId?: string) {
    if (!recipientId) {
      throw new BadRequestException('recipientId is required');
    }

    await this.settleReadMessageNotifications(recipientId);
    const excludeIds = await this.idsThisDeviceCannotRead(
      recipientId,
      sessionId,
    );
    const count = await this.notificationRepository.countUnread(
      recipientId,
      excludeIds,
    );

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

  /** Reading a message in the chat settles its notifications, so the bell does not count what was just seen. */
  async markMessageNotificationsAsRead(
    recipientId: string,
    messageIds: string[],
  ) {
    if (messageIds.length === 0) return { count: 0 };

    return this.notificationRepository.markMessageNotificationsAsRead({
      recipientId,
      messageIds,
      readAt: new Date(),
    });
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
