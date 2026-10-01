export type PostAuditAction = 'POST_HIDDEN' | 'POST_RESTORED';
export type CommentAuditAction = 'COMMENT_HIDDEN' | 'COMMENT_RESTORED';
export type ReportAuditAction =
  | 'REPORT_CLAIMED'
  | 'REPORT_RESOLVED'
  | 'REPORT_DISMISSED';
export type ModeratorAuditAction = 'MODERATOR_ASSIGNED' | 'MODERATOR_REMOVED';
export type UserModerationAuditAction =
  | 'USER_BANNED'
  | 'USER_SUSPENDED'
  | 'USER_REACTIVATED';

/** Stored shape of `metadata` for post entries. Rows are permanent - change by adding optional keys only. */
export type PostAuditMetadata = { authorId: string; postTitle: string };

/** Stored shape of `metadata` for comment entries. Rows are permanent - change by adding optional keys only. */
export type CommentAuditMetadata = { authorId: string; postId: string };

/** Stored shape of `metadata` for report entries. Rows are permanent - change by adding optional keys only. */
export type ReportAuditMetadata = {
  reportedTargetType: string;
  reportedTargetId: string;
  resolutionNote?: string;
};

/** Stored shape of `metadata` for user moderation entries. Rows are permanent - change by adding optional keys only. */
export type UserModerationAuditMetadata = {
  previousStatus: string;
  reason?: string;
};

interface AuditEntryBase {
  actorId: string;
  targetId: string;
  gameId?: string;
  /** Snapshots stored on the row; when omitted the repository looks them up. Pass what the caller already holds. */
  actorName?: string;
  gameSlug?: string;
}

/**
 * The only fields a caller may supply (id and createdAt are set on write).
 * A union on `action` so each action's target and metadata shape is fixed by
 * the type system rather than by whoever writes the next call site.
 */
export type AuditEntry = AuditEntryBase &
  (
    | {
        action: PostAuditAction;
        targetType: 'POST';
        metadata: PostAuditMetadata;
      }
    | {
        action: CommentAuditAction;
        targetType: 'COMMENT';
        metadata: CommentAuditMetadata;
      }
    | {
        action: ReportAuditAction;
        targetType: 'REPORT';
        metadata: ReportAuditMetadata;
      }
    | {
        action: ModeratorAuditAction;
        targetType: 'USER';
        metadata?: undefined;
      }
    | {
        action: UserModerationAuditAction;
        targetType: 'USER';
        metadata: UserModerationAuditMetadata;
      }
  );
