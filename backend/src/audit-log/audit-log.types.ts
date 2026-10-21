export type PostAuditAction = 'POST_HIDDEN' | 'POST_RESTORED';
export type CommentAuditAction = 'COMMENT_HIDDEN' | 'COMMENT_RESTORED';
export type CaseAuditAction =
  | 'CASE_ASSIGNED'
  | 'CASE_CLAIMED'
  | 'CASE_RESOLVED'
  | 'CASE_DISMISSED';
export type ModeratorAuditAction = 'MODERATOR_ASSIGNED' | 'MODERATOR_REMOVED';
export type UserModerationAuditAction =
  | 'USER_BANNED'
  | 'USER_SUSPENDED'
  | 'USER_REACTIVATED';
export type GameAuditAction =
  | 'GAME_ARCHIVED'
  | 'GAME_RESTORED'
  | 'GAME_FLAGGED';

export type ChatTimeoutAuditAction =
  | 'CHAT_USER_TIMED_OUT'
  | 'CHAT_TIMEOUT_LIFTED';
export type ChatChannelAuditAction =
  | 'CHAT_CHANNEL_CREATED'
  | 'CHAT_CHANNEL_UPDATED';

/** Stored shape of `metadata` for chat timeout entries. Rows are permanent - change by adding optional keys only. */
export type ChatTimeoutAuditMetadata = { until?: string; reason?: string };

/** Stored shape of `metadata` for chat room entries. Rows are permanent - change by adding optional keys only. */
export type ChatChannelAuditMetadata = {
  name: string;
  /** The settings that changed, as they are now. */
  changes?: Record<string, string | number | boolean | null>;
};

/** Stored shape of `metadata` for a message a moderator removed. Rows are permanent - change by adding optional keys only. */
export type ChatMessageAuditMetadata = {
  authorId: string | null;
  channelId: string;
  reason?: string;
};

/** Stored shape of `metadata` for post entries. Rows are permanent - change by adding optional keys only. */
export type PostAuditMetadata = { authorId: string; postTitle: string };

/** Stored shape of `metadata` for comment entries. Rows are permanent - change by adding optional keys only. */
export type CommentAuditMetadata = { authorId: string; postId: string };

/** Historical report audit metadata, read-only. New workflow writes use CaseAuditMetadata. */
export type ReportAuditMetadata = {
  /** Optional for historical entries created before case workflow. */
  reportId?: string;
  caseId?: string;
  reportedTargetType: string;
  reportedTargetId: string;
  resolutionNote?: string;
};

export type CaseAuditMetadata = {
  caseId: string;
  targetType: string;
  targetId: string;
  gameId: string | null;
  reportCount: number;
  assignedModeratorId?: string | null;
  resolutionNote?: string;
};

/** Stored shape of `metadata` for user moderation entries. Rows are permanent - change by adding optional keys only. */
export type UserModerationAuditMetadata = {
  previousStatus: string;
  reason?: string;
};

/** Stored shape of `metadata` for game entries. Rows are permanent - change by adding optional keys only. */
export type GameAuditMetadata = { reason?: string };

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
        action: CaseAuditAction;
        targetType: 'MODERATION_CASE';
        metadata: CaseAuditMetadata;
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
    | {
        action: GameAuditAction;
        targetType: 'GAME';
        metadata?: GameAuditMetadata;
      }
    | {
        action: ChatTimeoutAuditAction;
        targetType: 'USER';
        metadata?: ChatTimeoutAuditMetadata;
      }
    | {
        action: ChatChannelAuditAction;
        targetType: 'CHANNEL';
        metadata: ChatChannelAuditMetadata;
      }
    | {
        action: 'CHAT_MESSAGE_REMOVED';
        targetType: 'CHAT_MESSAGE';
        metadata: ChatMessageAuditMetadata;
      }
  );
