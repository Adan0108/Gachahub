import type { PostsRepository } from '../posts/posts.repository';
import type { CommentsRepository } from '../comments/comments.repository';
import type { ReportsRepository } from '../reports/reports.repository';

/*
 * Unit test only mocks repository dependencies. Do not load their real
 * implementations because they eventually import Prisma.
 */
jest.mock('../posts/posts.repository', () => ({
  PostsRepository: class {},
}));
jest.mock('../comments/comments.repository', () => ({
  CommentsRepository: class {},
}));
jest.mock('../reports/reports.repository', () => ({
  ReportsRepository: class {},
}));

import { ContentModerationService } from './content-moderation.service';

describe('ContentModerationService', () => {
  const postsRepository = { findManyByIdsForModeration: jest.fn() };
  const commentsRepository = { findManyByIdsForModeration: jest.fn() };
  const reportsRepository = { countAllByTarget: jest.fn() };

  let service: ContentModerationService;

  beforeEach(() => {
    jest.clearAllMocks();
    postsRepository.findManyByIdsForModeration.mockResolvedValue([]);
    commentsRepository.findManyByIdsForModeration.mockResolvedValue([]);

    service = new ContentModerationService(
      postsRepository as unknown as PostsRepository,
      commentsRepository as unknown as CommentsRepository,
      reportsRepository as unknown as ReportsRepository,
    );
  });

  it('merges report counts with post and comment details, sorted by report count', async () => {
    reportsRepository.countAllByTarget.mockResolvedValue([
      { targetType: 'POST', targetId: 'post-1', count: 2 },
      { targetType: 'COMMENT', targetId: 'comment-1', count: 5 },
    ]);
    postsRepository.findManyByIdsForModeration.mockResolvedValue([
      {
        id: 'post-1',
        title: 'A post',
        status: 'PUBLISHED',
        author: { name: 'Rover' },
        game: { slug: 'wuthering-waves' },
      },
    ]);
    commentsRepository.findManyByIdsForModeration.mockResolvedValue([
      {
        id: 'comment-1',
        content: 'Spam content',
        status: 'PUBLISHED',
        deletedAt: null,
        author: { name: 'Trailblazer' },
        post: { game: { slug: 'honkai-star-rail' } },
      },
    ]);

    const result = await service.listFlagged({ page: 1, limit: 20 });

    expect(postsRepository.findManyByIdsForModeration).toHaveBeenCalledWith([
      'post-1',
    ]);
    expect(commentsRepository.findManyByIdsForModeration).toHaveBeenCalledWith([
      'comment-1',
    ]);
    expect(result.items).toEqual([
      {
        id: 'comment-1',
        type: 'COMMENT',
        title: 'Spam content',
        authorName: 'Trailblazer',
        status: 'PUBLISHED',
        reportCount: 5,
        gameSlug: 'honkai-star-rail',
      },
      {
        id: 'post-1',
        type: 'POST',
        title: 'A post',
        authorName: 'Rover',
        status: 'PUBLISHED',
        reportCount: 2,
        gameSlug: 'wuthering-waves',
      },
    ]);
    expect(result.meta).toEqual({
      page: 1,
      limit: 20,
      total: 2,
      totalPages: 1,
    });
  });

  it('drops a reported target whose row no longer exists', async () => {
    reportsRepository.countAllByTarget.mockResolvedValue([
      { targetType: 'POST', targetId: 'deleted-post', count: 3 },
    ]);
    postsRepository.findManyByIdsForModeration.mockResolvedValue([]);

    const result = await service.listFlagged({ page: 1, limit: 20 });

    expect(result.items).toEqual([]);
    expect(result.meta.total).toBe(1);
  });

  it('shows a placeholder title for a reported comment that was soft-deleted', async () => {
    reportsRepository.countAllByTarget.mockResolvedValue([
      { targetType: 'COMMENT', targetId: 'comment-1', count: 1 },
    ]);
    commentsRepository.findManyByIdsForModeration.mockResolvedValue([
      {
        id: 'comment-1',
        content: 'Spam content',
        status: 'PUBLISHED',
        deletedAt: new Date(),
        author: { name: 'Trailblazer' },
        post: { game: { slug: 'honkai-star-rail' } },
      },
    ]);

    const result = await service.listFlagged({ page: 1, limit: 20 });

    expect(result.items[0].title).toBe('(comment deleted)');
  });

  it('paginates in memory over the sorted report-count groups', async () => {
    reportsRepository.countAllByTarget.mockResolvedValue([
      { targetType: 'POST', targetId: 'post-1', count: 1 },
      { targetType: 'POST', targetId: 'post-2', count: 9 },
    ]);
    postsRepository.findManyByIdsForModeration.mockResolvedValue([
      {
        id: 'post-2',
        title: 'Most reported',
        status: 'PUBLISHED',
        author: { name: 'Rover' },
        game: { slug: 'wuthering-waves' },
      },
    ]);

    const result = await service.listFlagged({ page: 1, limit: 1 });

    expect(postsRepository.findManyByIdsForModeration).toHaveBeenCalledWith([
      'post-2',
    ]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('post-2');
    expect(result.meta).toEqual({
      page: 1,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
  });

  it('breaks ties on targetId so equal counts have a stable, deterministic order', async () => {
    reportsRepository.countAllByTarget.mockResolvedValue([
      { targetType: 'POST', targetId: 'post-b', count: 1 },
      { targetType: 'POST', targetId: 'post-a', count: 1 },
    ]);
    postsRepository.findManyByIdsForModeration.mockResolvedValue([
      {
        id: 'post-a',
        title: 'Post A',
        status: 'PUBLISHED',
        author: { name: 'Rover' },
        game: { slug: 'wuthering-waves' },
      },
      {
        id: 'post-b',
        title: 'Post B',
        status: 'PUBLISHED',
        author: { name: 'Rover' },
        game: { slug: 'wuthering-waves' },
      },
    ]);

    const result = await service.listFlagged({ page: 1, limit: 20 });

    expect(result.items.map((item) => item.id)).toEqual(['post-a', 'post-b']);
  });

  it('filters to one target type server-side, before pagination', async () => {
    reportsRepository.countAllByTarget.mockResolvedValue([
      { targetType: 'POST', targetId: 'post-1', count: 5 },
      { targetType: 'COMMENT', targetId: 'comment-1', count: 3 },
    ]);

    const result = await service.listFlagged({
      page: 1,
      limit: 20,
      type: 'COMMENT',
    });

    expect(postsRepository.findManyByIdsForModeration).toHaveBeenCalledWith([]);
    expect(commentsRepository.findManyByIdsForModeration).toHaveBeenCalledWith([
      'comment-1',
    ]);
    expect(result.meta.total).toBe(1);
  });
});
