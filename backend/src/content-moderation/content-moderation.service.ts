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

    const postIds = filtered
      .filter((entry) => entry.targetType === 'POST')
      .map((entry) => entry.targetId);
    const commentIds = filtered
      .filter((entry) => entry.targetType === 'COMMENT')
      .map((entry) => entry.targetId);

    // Hydrated for the full filtered set, not just one page - excludeHidden
    // and the stale-target drop below both need to run before pagination,
    // not after, or `total`/a page's own item count go wrong.
    const [posts, comments] = await Promise.all([
      this.postsRepository.findManyByIdsForModeration(postIds),
      this.commentsRepository.findManyByIdsForModeration(commentIds),
    ]);

    const postById = new Map(posts.map((post) => [post.id, post]));
    const commentById = new Map(
      comments.map((comment) => [comment.id, comment]),
    );

    const items = filtered
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
      // report's target can vanish out from under it - drop the stale row.
      .filter((item): item is FlaggedItem => item !== undefined)
      .filter((item) => !query.excludeHidden || item.status !== 'HIDDEN');

    // Tiebreak on id: most targets have exactly one open report, and
    // countAllByTarget's groupBy has no orderBy of its own, so without this
    // the order among equal counts is whatever Postgres happened to return
    // this time - different on every request, including between page 1 and
    // page 2. Same discipline as findHiddenByGame's [updatedAt desc, id desc].
    const sorted = items.sort(
      (a, b) => b.reportCount - a.reportCount || a.id.localeCompare(b.id),
    );
    const total = sorted.length;
    const start = (page - 1) * limit;
    const pageItems = sorted.slice(start, start + limit);

    return toPaginated(pageItems, { page, limit, total });
  }
}
