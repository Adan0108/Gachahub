import type {
  PostStatus,
  PostType,
  PostVisibility,
  PostMediaType,
  CommentStatus,
} from '../../generated/prisma/client';

/** Versioned, backend-only evidence. No user/account credentials or remote bytes. */
export type ReportTargetSnapshot = PostReportSnapshot | CommentReportSnapshot;

export type PostReportSnapshot = {
  version: 1;
  targetType: 'POST';
  postId: string;
  authorId: string;
  title: string;
  content: string;
  status: PostStatus;
  visibility: PostVisibility;
  gameId: string | null;
  type: PostType | null;
  categoryId: string | null;
  media: Array<{
    id: string;
    mediaUploadId: string;
    mediaType: PostMediaType;
    url: string;
    assetId: string;
    publicId: string;
    altText: string | null;
    sortOrder: number;
    width: number | null;
    height: number | null;
    duration: number | null;
    bytes: number | null;
    format: string | null;
  }>;
};

export type CommentReportSnapshot = {
  version: 1;
  targetType: 'COMMENT';
  commentId: string;
  authorId: string;
  content: string;
  status: CommentStatus;
  postId: string;
  parentId: string | null;
  gameId: string | null;
};
