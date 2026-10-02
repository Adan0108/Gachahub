import { AuditTargetType } from '../generated/prisma/client';
import type {
  CommentAuditMetadata,
  PostAuditMetadata,
  ReportAuditMetadata,
} from '../audit-log/audit-log.types';
import type { AuditLogQueryService } from '../audit-log/audit-log-query.service';

/**
 * One row of AuditLogQueryService.listAllForAdmin's `items` - inferred
 * rather than hand-declared, so this can't drift from what that service
 * actually returns.
 */
export type AuditLogEntryForActivity = Awaited<
  ReturnType<AuditLogQueryService['listAllForAdmin']>
>['items'][number];

/**
 * Turns a page of raw audit log rows into the admin dashboard's activity
 * feed: ids and enum values only, no display copy (that's the frontend's
 * job, same as STATUS_LABEL/MODES on the other admin pages) - except
 * `targetName`, which is real data (a post's title, a banned user's name),
 * not prose, so it's resolved here where the lookups live.
 */
export function formatActivityEntries(
  entries: AuditLogEntryForActivity[],
  userNameById: Map<string, string>,
) {
  return entries.map((entry) => ({
    id: entry.id,
    action: entry.action,
    // Denormalized on the row (see AuditLogRepository.create's docblock),
    // so it survives the actor's own account being deleted later.
    actorName: entry.actorName ?? 'Deleted user',
    targetType: entry.targetType,
    targetId: entry.targetId,
    targetName: resolveTargetName(entry, userNameById),
    occurredAt: entry.createdAt,
  }));
}

/**
 * Resolves the one piece of friendlier data each target type can offer -
 * a post's title, a comment's parent post id, a report's own target, a
 * user's name - or null when none is available, leaving the frontend to
 * decide how to render that (typically falling back to the raw id). The
 * `never` assignment in `default` makes this fail to compile if
 * AuditTargetType ever grows a fifth value without a case here, instead of
 * silently returning null for it.
 */
function resolveTargetName(
  entry: AuditLogEntryForActivity,
  userNameById: Map<string, string>,
): string | null {
  switch (entry.targetType) {
    case AuditTargetType.POST:
      return (entry.metadata as PostAuditMetadata | null)?.postTitle ?? null;
    case AuditTargetType.COMMENT:
      return (entry.metadata as CommentAuditMetadata | null)?.postId ?? null;
    case AuditTargetType.REPORT: {
      const metadata = entry.metadata as ReportAuditMetadata | null;
      return metadata?.reportedTargetId
        ? `${metadata.reportedTargetType} ${metadata.reportedTargetId}`
        : null;
    }
    case AuditTargetType.USER:
      return userNameById.get(entry.targetId) ?? null;
    case AuditTargetType.GAME:
      // Already denormalized on the row - no extra lookup needed.
      return entry.gameSlug ?? null;
    default: {
      const exhaustiveCheck: never = entry.targetType;
      return exhaustiveCheck;
    }
  }
}
