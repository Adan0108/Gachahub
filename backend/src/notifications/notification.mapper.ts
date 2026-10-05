import { NotificationEntityType } from '../generated/prisma/client';

interface MappableNotification {
  entityType: NotificationEntityType;
  entityId: string;
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
