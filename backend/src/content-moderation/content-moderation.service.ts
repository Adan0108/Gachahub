import { Injectable } from '@nestjs/common';
import { CommentsRepository } from '../comments/comments.repository';
import { PostsRepository } from '../posts/posts.repository';
import { ReportsRepository } from '../reports/reports.repository';
import { resolvePagination, toPaginated } from '../common/utils/paginated';
import { QueryContentModerationDto } from './dto/query-content-moderation.dto';

export interface FlaggedItem {
  id: string;
  type: 'POST' | 'COMMENT';
  title: string;
  authorName: string;
  status: string;
  reportCount: number;
  gameSlug: string;
}

/**
 * Cross-game "what still needs review" queue for the admin content page -
 * every target with at least one open (PENDING/IN_REVIEW) report. A report's
 * target is polymorphic (POST or COMMENT, see the Report model's schema
 * comment), so this can't be a single Prisma query - it groups reports by
 * target first, then hydrates that page of ids against Post and Comment
 * directly. Bounded by the open queue, not by all report history (see
 * ReportsRepository.countAllByTarget), so pagination happens in memory
 * after one groupBy rather than pushing skip/take into Postgres.
 */
@Injectable()
export class ContentModerationService {
  constructor(
    private readonly postsRepository: PostsRepository,
    private readonly commentsRepository: CommentsRepository,
    private readonly reportsRepository: ReportsRepository,
  ) {}

  async listFlagged(query: QueryContentModerationDto) {
    const { page, limit } = resolvePagination(query);

    const counts = await this.reportsRepository.countAllByTarget();
    const filtered = query.type
      ? counts.filter((entry) => entry.targetType === query.type)
      : counts;
    // Tiebreak on targetId: most targets have exactly one open report, and
    // countAllByTarget's groupBy has no orderBy of its own, so without this
    // the order among equal counts is whatever Postgres happened to return
    // this time - different on every request, including between page 1 and
    // page 2. Same discipline as findHiddenByGame's [updatedAt desc, id desc].
    const sorted = [...filtered].sort(
      (a, b) => b.count - a.count || a.targetId.localeCompare(b.targetId),
    );
    const total = sorted.length;
    const start = (page - 1) * limit;
    const pageSlice = sorted.slice(start, start + limit);

    const postIds = pageSlice
      .filter((entry) => entry.targetType === 'POST')
      .map((entry) => entry.targetId);
    const commentIds = pageSlice
      .filter((entry) => entry.targetType === 'COMMENT')
      .map((entry) => entry.targetId);

    const [posts, comments] = await Promise.all([
      this.postsRepository.findManyByIdsForModeration(postIds),
      this.commentsRepository.findManyByIdsForModeration(commentIds),
    ]);

    const postById = new Map(posts.map((post) => [post.id, post]));
    const commentById = new Map(
      comments.map((comment) => [comment.id, comment]),
    );

    const items = pageSlice
      .map((entry): FlaggedItem | undefined => {
        if (entry.targetType === 'POST') {
          const post = postById.get(entry.targetId);
          return (
            post && {
              id: post.id,
              type: 'POST',
              title: post.title,
              authorName: post.author.name,
              status: post.status,
              reportCount: entry.count,
              gameSlug: post.game.slug,
            }
          );
        }

        const comment = commentById.get(entry.targetId);
        return (
          comment && {
            id: comment.id,
            type: 'COMMENT',
            title: comment.deletedAt
              ? '(comment deleted)'
              : comment.content.slice(0, 140),
            authorName: comment.author.name,
            status: comment.status,
            reportCount: entry.count,
            gameSlug: comment.post.game.slug,
          }
        );
      })
      // Post/Comment cascade-delete when their author is removed, so a
      // report's target can vanish out from under it - drop the stale
      // row rather than surfacing a hole in the list. `total`/`totalPages`
      // are counted before this filter runs (counting after would mean
      // hydrating every target up front, not just the current page), so
      // they're an upper bound: a dropped stale row can make a page come
      // back with fewer items than `limit` without that being the last page.
      .filter((item): item is FlaggedItem => item !== undefined);

    return toPaginated(items, { page, limit, total });
  }
}
