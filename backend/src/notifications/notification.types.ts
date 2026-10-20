import {
  NotificationEntityType,
  NotificationType,
} from '../generated/prisma/client';

export type CreateNotificationInput = {
  recipientId: string;
  actorId?: string | null;

  type: NotificationType;

  entityType: NotificationEntityType;
  entityId: string;
  /** The chat conversation, for chat notifications. */
  conversationId?: string | null;
};
