export const DOMAIN_EVENT_TYPES = {
  POST_LIKED: 'post.liked',
  COMMENT_CREATED: 'comment.created',
  USER_FOLLOWED: 'user.followed',
  USER_MENTIONED: 'user.mentioned',

  CHAT_MESSAGE_SENT: 'chat.message.sent',
  CHAT_PARTICIPANT_ADDED: 'chat.participant.added',
} as const;

export type DomainEventType =
  (typeof DOMAIN_EVENT_TYPES)[keyof typeof DOMAIN_EVENT_TYPES];

export type MentionTargetType = 'POST' | 'COMMENT' | 'MESSAGE';

export type ChatParticipantAddedState = 'ACTIVE' | 'PENDING';

/**
 * Payload contract for every domain event.
 *
 * Domain events describe business facts.
 * They must not contain Kafka-specific information or
 * notification-specific enums.
 */
export interface DomainEventPayloadMap {
  'post.liked': {
    postId: string;
    postAuthorId: string;
    actorId: string;
  };

  /**
   * One event covers both:
   * - comment on a post
   * - reply to another comment
   *
   * The consumer decides whether this becomes
   * POST_COMMENTED, COMMENT_REPLIED, or both where appropriate.
   */
  'comment.created': {
    commentId: string;
    postId: string;
    postAuthorId: string;
    actorId: string;

    parentCommentId: string | null;
    parentCommentAuthorId: string | null;
  };

  'user.followed': {
    targetUserId: string;
    actorId: string;
  };

  /**
   * Emit one event per mentioned user.
   */
  'user.mentioned': {
    targetUserId: string;
    actorId: string;
    entityType: MentionTargetType;
    entityId: string;
  };

  /**
   * Important for MLS/E2EE:
   *
   * Never put plaintext message content in this event.
   * The backend only needs message/conversation metadata.
   *
   * replyToMessageId allows NotificationConsumer to distinguish
   * MESSAGE_RECEIVED from MESSAGE_REPLIED later.
   */
  'chat.message.sent': {
    messageId: string;
    conversationId: string;
    senderId: string;
    replyToMessageId: string | null;
  };

  /**
   * ChatParticipant.state determines whether this becomes:
   *
   * ACTIVE  -> GROUP_ADDED
   * PENDING -> GROUP_INVITE_PENDING
   */
  'chat.participant.added': {
    conversationId: string;
    addedUserId: string;
    actorId: string;
    state: ChatParticipantAddedState;
  };
}

/**
 * One concrete typed event.
 */
export interface DomainEventOf<TType extends DomainEventType> {
  eventId: string;
  type: TType;

  /**
   * Version of this specific event contract.
   */
  version: number;

  occurredAt: string;

  /**
   * Used later as the Kafka partition key.
   *
   * Examples:
   * post events -> postId
   * chat events -> conversationId
   * user events -> targetUserId
   */
  aggregateId: string;

  payload: DomainEventPayloadMap[TType];
}

/**
 * Proper discriminated union of every supported event.
 *
 * This preserves the relationship between event.type
 * and event.payload.
 */
export type DomainEvent = {
  [TType in DomainEventType]: DomainEventOf<TType>;
}[DomainEventType];
