import { Injectable } from '@nestjs/common';
import type { PostStatus, PostVisibility } from '../generated/prisma/client';
import { FollowsService } from '../follows/follows.service';

export interface ViewablePostFields {
  status: PostStatus;
  visibility: PostVisibility;
  authorId: string;
  deletedAt: Date | null;
}

/**
 * The platform's single answer to "can this user view this post".
 *
 * PUBLIC posts are open to everyone. FOLLOWERS_ONLY posts are open to the
 * author and to anyone who follows the author - the check is one-directional
 * (viewer follows author), the author does not need to follow back. Anything
 * else - PRIVATE, DRAFT, HIDDEN, DELETED - is not viewable by a non-author.
 *
 * Shared by PostsService (like/unlike and the non-author tail of findOne),
 * CommentsService, and ReportsService. It had drifted into several
 * near-identical copies before this existed. Callers that need an
 * author-always-sees-their-own bypass regardless of status (PostsService.findOne)
 * check that first, since it's a different rule from the one owned here.
 */
@Injectable()
export class PostVisibilityService {
  constructor(private readonly followsService: FollowsService) {}

  /**
   * Only queries the follow graph when it can change the answer:
   * FOLLOWERS_ONLY, a signed-in viewer, and the viewer isn't the author.
   */
  async canView(post: ViewablePostFields, userId?: string): Promise<boolean> {
    if (post.deletedAt || post.status !== 'PUBLISHED') {
      return false;
    }

    if (post.visibility === 'PUBLIC') {
      return true;
    }

    if (post.visibility === 'FOLLOWERS_ONLY' && userId) {
      if (post.authorId === userId) {
        return true;
      }

      const followStatus = await this.followsService.isFollowing(
        userId,
        post.authorId,
      );

      return followStatus.following;
    }

    return false;
  }
}
