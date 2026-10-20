import { NotificationEntityType } from '../generated/prisma/client';

interface MappableNotification {
  entityType: NotificationEntityType;
  entityId: string;
  conversationId?: string | null;
}

/** The comments among these notifications - the only ones that need a post looked up. */
export function commentEntityIds(items: MappableNotification[]): string[] {
  return items
    .filter((item) => item.entityType === NotificationEntityType.COMMENT)
    .map((item) => item.entityId);
}

/** Comment notifications carry the post their comment sits on (null if it can't be reached); every other kind carries null. */
export function withPostIds<T extends MappableNotification>(
  items: T[],
  postIdByCommentId: Map<string, string>,
) {
  return items.map((item) => ({
    ...item,
    postId:
      item.entityType === NotificationEntityType.COMMENT
        ? (postIdByCommentId.get(item.entityId) ?? null)
        : null,
  }));
}

/** The chat messages among these notifications - the ones that need their conversation looked up. */
export function messageEntityIds(items: MappableNotification[]): string[] {
  return items
    .filter((item) => item.entityType === NotificationEntityType.MESSAGE)
    .map((item) => item.entityId);
}

/** Chat notifications carry the conversation to open: a message's own, or the one a group notification is about; every other kind carries null. */
export function withConversationIds<T extends MappableNotification>(
  items: T[],
  conversationIdByMessageId: Map<string, string>,
) {
  return items.map((item) => ({
    ...item,
    conversationId:
      item.conversationId ??
      (item.entityType === NotificationEntityType.MESSAGE
        ? (conversationIdByMessageId.get(item.entityId) ?? null)
        : item.entityType === NotificationEntityType.CONVERSATION
          ? item.entityId
          : null),
  }));
}

/** Chat notifications also say what kind of conversation they are from and, for a group, its name and photo; every other kind carries null. */
export function withConversations<T extends { conversationId: string | null }>(
  items: T[],
  summaryById: Map<
    string,
    { id: string; type: string; title: string | null; photoUrl: string | null }
  >,
) {
  return items.map((item) => {
    const summary = item.conversationId
      ? summaryById.get(item.conversationId)
      : undefined;

    return {
      ...item,
      conversation: summary
        ? {
            type: summary.type,
            title: summary.title,
            photoUrl: summary.photoUrl,
          }
        : null,
    };
  });
}
