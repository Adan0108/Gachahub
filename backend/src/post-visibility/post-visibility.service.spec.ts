import type { FollowsService } from '../follows/follows.service';

/*
 * Unit test only mocks the follow graph. Do not load the real
 * implementation because it eventually imports Prisma.
 */
jest.mock('../follows/follows.service', () => ({
  FollowsService: class {},
}));

import { PostVisibilityService } from './post-visibility.service';

describe('PostVisibilityService', () => {
  const followsService = {
    isFollowing: jest.fn(),
  };

  let service: PostVisibilityService;

  const publishedPost = {
    status: 'PUBLISHED' as const,
    visibility: 'PUBLIC' as const,
    authorId: 'author-1',
    deletedAt: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PostVisibilityService(
      followsService as unknown as FollowsService,
    );
  });

  describe('PUBLIC posts', () => {
    it('are viewable by anonymous visitors, without a follow lookup', async () => {
      await expect(service.canView(publishedPost)).resolves.toBe(true);

      expect(followsService.isFollowing).not.toHaveBeenCalled();
    });

    it('are viewable by any signed-in user', async () => {
      await expect(service.canView(publishedPost, 'user-1')).resolves.toBe(
        true,
      );
    });
  });

  describe('non-published or deleted posts', () => {
    it.each(['DRAFT', 'HIDDEN', 'DELETED'] as const)(
      'are never viewable when status is %s, even by the author',
      async (status) => {
        await expect(
          service.canView({ ...publishedPost, status }, 'author-1'),
        ).resolves.toBe(false);
      },
    );

    it('are never viewable when deletedAt is set, even if status has not caught up', async () => {
      await expect(
        service.canView(
          { ...publishedPost, deletedAt: new Date() },
          'author-1',
        ),
      ).resolves.toBe(false);
    });
  });

  describe('PRIVATE posts', () => {
    it('are not viewable by anyone, including the author', async () => {
      const privatePost = { ...publishedPost, visibility: 'PRIVATE' as const };

      await expect(service.canView(privatePost, 'author-1')).resolves.toBe(
        false,
      );
      await expect(service.canView(privatePost, 'user-1')).resolves.toBe(false);
    });
  });

  describe('FOLLOWERS_ONLY posts', () => {
    const followersOnly = {
      ...publishedPost,
      visibility: 'FOLLOWERS_ONLY' as const,
    };

    it('are not viewable by anonymous visitors, without a follow lookup', async () => {
      await expect(service.canView(followersOnly)).resolves.toBe(false);

      expect(followsService.isFollowing).not.toHaveBeenCalled();
    });

    it('are viewable by the author, without a follow lookup', async () => {
      await expect(service.canView(followersOnly, 'author-1')).resolves.toBe(
        true,
      );

      expect(followsService.isFollowing).not.toHaveBeenCalled();
    });

    it('are viewable by a follower of the author', async () => {
      followsService.isFollowing.mockResolvedValue({ following: true });

      await expect(service.canView(followersOnly, 'user-1')).resolves.toBe(
        true,
      );
    });

    it('checks only the viewer -> author direction, no reciprocity needed', async () => {
      followsService.isFollowing.mockResolvedValue({ following: true });

      await service.canView(followersOnly, 'user-1');

      expect(followsService.isFollowing).toHaveBeenCalledTimes(1);
      expect(followsService.isFollowing).toHaveBeenCalledWith(
        'user-1',
        'author-1',
      );
    });

    it('are not viewable by a non-follower', async () => {
      followsService.isFollowing.mockResolvedValue({ following: false });

      await expect(service.canView(followersOnly, 'user-1')).resolves.toBe(
        false,
      );
    });
  });
});
