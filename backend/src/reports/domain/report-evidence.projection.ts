import type { ReportTargetType } from '../../generated/prisma/client';

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Deliberate version-1 public evidence allowlist; unknown/malformed snapshots stay null. */
export function projectReportSnapshot(
  value: unknown,
  targetType: ReportTargetType,
  targetId: string,
) {
  const snapshot = object(value);
  if (
    !snapshot ||
    snapshot.version !== 1 ||
    snapshot.targetType !== targetType ||
    snapshot[targetType === 'POST' ? 'postId' : 'commentId'] !== targetId ||
    typeof snapshot.content !== 'string'
  )
    return null;
  return {
    version: 1 as const,
    targetType,
    targetId,
    authorId: text(snapshot.authorId),
    content: snapshot.content,
    title: targetType === 'POST' ? text(snapshot.title) : null,
    status: text(snapshot.status),
    visibility: targetType === 'POST' ? text(snapshot.visibility) : null,
    postId: targetType === 'COMMENT' ? text(snapshot.postId) : null,
    parentId: targetType === 'COMMENT' ? text(snapshot.parentId) : null,
    media:
      targetType === 'POST' && Array.isArray(snapshot.media)
        ? snapshot.media.slice(0, 20).flatMap((entry: unknown) => {
            const media = object(entry);
            return media && typeof media.url === 'string'
              ? [
                  {
                    url: media.url,
                    mediaType: text(media.mediaType),
                    altText: text(media.altText),
                  },
                ]
              : [];
          })
        : [],
  };
}
