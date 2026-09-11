import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { PostSortDto } from './dto/query-posts.dto';
import type { PostsRepository } from './posts.repository';
import type { MediaService } from '../media/media.service';
import type { FollowsService } from '../follows/follows.service';
import type { UserInterestService } from '../recommendation/user-interest.service';

/*
 * Unit test only mocks service dependencies.
 *
 * Do not load their real implementations because MediaService and
 * FollowsService eventually import Prisma.
 */
jest.mock('./posts.repository', () => ({
  PostsRepository: class {},
}));

jest.mock('../media/media.service', () => ({
  MediaService: class {},
}));

jest.mock('../follows/follows.service', () => ({
  FollowsService: class {},
}));

jest.mock('../recommendation/user-interest.service', () => ({
  UserInterestService: class {},
}));

import { PostsService } from './posts.service';

describe('PostsService', () => {
  const postsRepository = {
    findMany: jest.fn(),
    count: jest.fn(),
    findPublishedById: jest.fn(),
    findByAuthorId: jest.fn(),

    findGameById: jest.fn(),
    findCategoryById: jest.fn(),

    create: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),

    findPostForInteraction: jest.fn(),
    like: jest.fn(),
    unlike: jest.fn(),
  };

  const mediaService = {
    getAttachableUploads: jest.fn(),
  };

  const followsService = {
    isFollowing: jest.fn(),
  };

  const userInterestService = {
    recordPostInteraction: jest.fn(),
  };

  let service: PostsService;

  const basePost = {
    id: 'post-1',
    authorId: 'author-1',

    gameId: 'game-1',
    categoryId: 'category-1',

    title: 'Test post',
    content: 'Test content',

    type: 'GENERAL',
    status: 'PUBLISHED',
    visibility: 'PUBLIC',

    isSpoiler: false,

    viewCount: 0,
    commentCount: 0,
    reactionCount: 0,
    saveCount: 0,
    shareCount: 0,

    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,

    author: {
      id: 'author-1',
      name: 'Author',
      image: null,
    },

    game: {
      id: 'game-1',
      name: 'Wuthering Waves',
      slug: 'wuthering-waves',
      iconUrl: null,
    },

    category: {
      id: 'category-1',
      name: 'General',
      slug: 'general',
    },

    media: [],

    tags: [],

    postLikes: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();

    service = new PostsService(
      postsRepository as unknown as PostsRepository,
      mediaService as unknown as MediaService,
      followsService as unknown as FollowsService,
      userInterestService as unknown as UserInterestService,
    );
  });

  describe('findAll', () => {
    it('returns published public posts with default pagination', async () => {
      postsRepository.findMany.mockResolvedValue([basePost]);

      postsRepository.count.mockResolvedValue(1);

      const result = await service.findAll({});

      expect(postsRepository.findMany).toHaveBeenCalledWith({
        where: {
          status: 'PUBLISHED',
          visibility: 'PUBLIC',
          deletedAt: null,
        },

        skip: 0,
        take: 20,

        orderBy: [
          {
            createdAt: 'desc',
          },
          {
            id: 'desc',
          },
        ],

        userId: undefined,
      });

      expect(postsRepository.count).toHaveBeenCalledWith({
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        deletedAt: null,
      });

      expect(result.items).toHaveLength(1);

      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
    });

    it('passes current user to repository for likedByCurrentUser', async () => {
      postsRepository.findMany.mockResolvedValue([]);

      postsRepository.count.mockResolvedValue(0);

      await service.findAll({}, 'user-1');

      expect(postsRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
        }),
      );
    });

    it('uses popular sorting', async () => {
      postsRepository.findMany.mockResolvedValue([]);

      postsRepository.count.mockResolvedValue(0);

      await service.findAll({
        sort: PostSortDto.POPULAR,
      });

      expect(postsRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            {
              saveCount: 'desc',
            },
            {
              commentCount: 'desc',
            },
            {
              reactionCount: 'desc',
            },
            {
              shareCount: 'desc',
            },
            {
              createdAt: 'desc',
            },
            {
              id: 'desc',
            },
          ],
        }),
      );
    });
  });

  describe('findOne', () => {
    it('returns published post', async () => {
      postsRepository.findPublishedById.mockResolvedValue(basePost);

      const result = await service.findOne('post-1', 'user-1');

      expect(postsRepository.findPublishedById).toHaveBeenCalledWith(
        'post-1',
        'user-1',
      );

      expect(result).toEqual(
        expect.objectContaining({
          id: 'post-1',
          likedByCurrentUser: false,
        }),
      );
    });

    it('throws when post does not exist', async () => {
      postsRepository.findPublishedById.mockResolvedValue(null);

      await expect(service.findOne('missing-post', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByAuthor', () => {
    it('passes viewer userId to repository', async () => {
      postsRepository.findByAuthorId.mockResolvedValue({
        items: [],
        total: 0,
      });

      await service.findByAuthor({}, 'author-1', 'viewer-1');

      expect(postsRepository.findByAuthorId).toHaveBeenCalledWith('author-1', {
        page: 1,
        limit: 20,
        userId: 'viewer-1',
      });
    });
  });

  describe('findByAuthorPublic', () => {
    it('only requests public published posts', async () => {
      postsRepository.findByAuthorId.mockResolvedValue({
        items: [],
        total: 0,
      });

      await service.findByAuthorPublic({}, 'author-1', 'viewer-1');

      expect(postsRepository.findByAuthorId).toHaveBeenCalledWith('author-1', {
        page: 1,
        limit: 20,
        visibility: 'PUBLIC',
        status: 'PUBLISHED',
        userId: 'viewer-1',
      });
    });
  });

  describe('create', () => {
    it('creates post with trimmed title and content', async () => {
      postsRepository.findGameById.mockResolvedValue({
        id: 'game-1',
        status: 'ACTIVE',
      });

      postsRepository.findCategoryById.mockResolvedValue({
        id: 'category-1',
        gameId: 'game-1',
        isActive: true,
      });

      mediaService.getAttachableUploads.mockResolvedValue([]);

      postsRepository.create.mockResolvedValue(basePost);

      const result = await service.create(
        {
          gameId: 'game-1',
          categoryId: 'category-1',
          title: '  Test post  ',
          content: '  Test content  ',
          tags: ['DPS', ' dps ', 'Build'],
        },
        'author-1',
      );

      expect(postsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          authorId: 'author-1',
          gameId: 'game-1',
          categoryId: 'category-1',

          title: 'Test post',
          content: 'Test content',

          media: [],
        }),
      );

      expect(result.id).toBe('post-1');
    });

    it('throws when game does not exist', async () => {
      postsRepository.findGameById.mockResolvedValue(null);

      await expect(
        service.create(
          {
            gameId: 'missing-game',
            title: 'Title',
            content: 'Content',
          },
          'author-1',
        ),
      ).rejects.toThrow(NotFoundException);

      expect(postsRepository.create).not.toHaveBeenCalled();
    });

    it('throws when game is not active', async () => {
      postsRepository.findGameById.mockResolvedValue({
        id: 'game-1',
        status: 'ARCHIVED',
      });

      await expect(
        service.create(
          {
            gameId: 'game-1',
            title: 'Title',
            content: 'Content',
          },
          'author-1',
        ),
      ).rejects.toThrow(NotFoundException);

      expect(postsRepository.create).not.toHaveBeenCalled();
    });

    it('throws when category belongs to another game', async () => {
      postsRepository.findGameById.mockResolvedValue({
        id: 'game-1',
        status: 'ACTIVE',
      });

      postsRepository.findCategoryById.mockResolvedValue({
        id: 'category-1',
        gameId: 'game-2',
        isActive: true,
      });

      await expect(
        service.create(
          {
            gameId: 'game-1',
            categoryId: 'category-1',
            title: 'Title',
            content: 'Content',
          },
          'author-1',
        ),
      ).rejects.toThrow(NotFoundException);

      expect(postsRepository.create).not.toHaveBeenCalled();
    });

    it('rejects more than 10 images', async () => {
      postsRepository.findGameById.mockResolvedValue({
        id: 'game-1',
        status: 'ACTIVE',
      });

      mediaService.getAttachableUploads.mockResolvedValue(
        Array.from(
          {
            length: 11,
          },
          (_, index) => ({
            id: `upload-${index}`,
            resourceType: 'IMAGE',
          }),
        ),
      );

      await expect(
        service.create(
          {
            gameId: 'game-1',
            title: 'Title',
            content: 'Content',

            media: Array.from(
              {
                length: 11,
              },
              (_, index) => ({
                mediaUploadId: `upload-${index}`,
              }),
            ),
          },
          'author-1',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(postsRepository.create).not.toHaveBeenCalled();
    });

    it('rejects more than one video', async () => {
      postsRepository.findGameById.mockResolvedValue({
        id: 'game-1',
        status: 'ACTIVE',
      });

      mediaService.getAttachableUploads.mockResolvedValue([
        {
          id: 'video-1',
          resourceType: 'VIDEO',
        },
        {
          id: 'video-2',
          resourceType: 'VIDEO',
        },
      ]);

      await expect(
        service.create(
          {
            gameId: 'game-1',
            title: 'Title',
            content: 'Content',

            media: [
              {
                mediaUploadId: 'video-1',
              },
              {
                mediaUploadId: 'video-2',
              },
            ],
          },
          'author-1',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(postsRepository.create).not.toHaveBeenCalled();
    });

    it('rejects mixing image and video', async () => {
      postsRepository.findGameById.mockResolvedValue({
        id: 'game-1',
        status: 'ACTIVE',
      });

      mediaService.getAttachableUploads.mockResolvedValue([
        {
          id: 'image-1',
          resourceType: 'IMAGE',
        },
        {
          id: 'video-1',
          resourceType: 'VIDEO',
        },
      ]);

      await expect(
        service.create(
          {
            gameId: 'game-1',
            title: 'Title',
            content: 'Content',

            media: [
              {
                mediaUploadId: 'image-1',
              },
              {
                mediaUploadId: 'video-1',
              },
            ],
          },
          'author-1',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(postsRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates own post', async () => {
      postsRepository.findById.mockResolvedValue(basePost);

      postsRepository.update.mockResolvedValue({
        ...basePost,
        title: 'Updated title',
      });

      const result = await service.update(
        'post-1',
        {
          title: '  Updated title  ',
        },
        'author-1',
      );

      expect(postsRepository.update).toHaveBeenCalledWith({
        id: 'post-1',

        data: {
          title: 'Updated title',
        },

        tags: undefined,
      });

      expect(result.title).toBe('Updated title');
    });

    it('rejects updating another user post', async () => {
      postsRepository.findById.mockResolvedValue(basePost);

      await expect(
        service.update(
          'post-1',
          {
            title: 'Changed',
          },
          'other-user',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(postsRepository.update).not.toHaveBeenCalled();
    });

    it('rejects updating deleted post', async () => {
      postsRepository.findById.mockResolvedValue({
        ...basePost,
        status: 'DELETED',
      });

      await expect(
        service.update(
          'post-1',
          {
            title: 'Changed',
          },
          'author-1',
        ),
      ).rejects.toThrow(NotFoundException);

      expect(postsRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('soft deletes own post', async () => {
      postsRepository.findById.mockResolvedValue(basePost);

      postsRepository.softDelete.mockResolvedValue({
        ...basePost,
        status: 'DELETED',
        deletedAt: new Date(),
      });

      const result = await service.remove('post-1', 'author-1');

      expect(postsRepository.softDelete).toHaveBeenCalledWith('post-1');

      expect(result).toEqual({
        message: 'Post deleted successfully',
      });
    });

    it('rejects deleting another user post', async () => {
      postsRepository.findById.mockResolvedValue(basePost);

      await expect(service.remove('post-1', 'other-user')).rejects.toThrow(
        ForbiddenException,
      );

      expect(postsRepository.softDelete).not.toHaveBeenCalled();
    });

    it('rejects deleting already deleted post', async () => {
      postsRepository.findById.mockResolvedValue({
        ...basePost,
        status: 'DELETED',
      });

      await expect(service.remove('post-1', 'author-1')).rejects.toThrow(
        NotFoundException,
      );

      expect(postsRepository.softDelete).not.toHaveBeenCalled();
    });
  });

  describe('like', () => {
    it('likes public post and records LIKE when state changed', async () => {
      postsRepository.findPostForInteraction.mockResolvedValue({
        id: 'post-1',
        authorId: 'author-1',
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        deletedAt: null,
      });

      postsRepository.like.mockResolvedValue({
        liked: true,
        likeCount: 11,
        changed: true,
      });

      const result = await service.like('post-1', 'user-1');

      expect(postsRepository.like).toHaveBeenCalledWith('post-1', 'user-1');

      expect(userInterestService.recordPostInteraction).toHaveBeenCalledWith(
        'user-1',
        'post-1',
        'LIKE',
      );

      expect(result).toEqual({
        liked: true,
        likeCount: 11,
      });
    });

    it('does not record LIKE again when duplicate like does not change state', async () => {
      postsRepository.findPostForInteraction.mockResolvedValue({
        id: 'post-1',
        authorId: 'author-1',
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        deletedAt: null,
      });

      postsRepository.like.mockResolvedValue({
        liked: true,
        likeCount: 11,
        changed: false,
      });

      await service.like('post-1', 'user-1');

      expect(userInterestService.recordPostInteraction).not.toHaveBeenCalled();
    });

    it('allows follower to like FOLLOWERS_ONLY post', async () => {
      postsRepository.findPostForInteraction.mockResolvedValue({
        id: 'post-1',
        authorId: 'author-1',
        status: 'PUBLISHED',
        visibility: 'FOLLOWERS_ONLY',
        deletedAt: null,
      });

      followsService.isFollowing.mockResolvedValue({
        following: true,
      });

      postsRepository.like.mockResolvedValue({
        liked: true,
        likeCount: 5,
        changed: true,
      });

      await service.like('post-1', 'user-1');

      expect(followsService.isFollowing).toHaveBeenCalledWith(
        'user-1',
        'author-1',
      );

      expect(postsRepository.like).toHaveBeenCalledWith('post-1', 'user-1');
    });

    it('allows author to like own FOLLOWERS_ONLY post without follow lookup', async () => {
      postsRepository.findPostForInteraction.mockResolvedValue({
        id: 'post-1',
        authorId: 'author-1',
        status: 'PUBLISHED',
        visibility: 'FOLLOWERS_ONLY',
        deletedAt: null,
      });

      postsRepository.like.mockResolvedValue({
        liked: true,
        likeCount: 5,
        changed: true,
      });

      await service.like('post-1', 'author-1');

      expect(followsService.isFollowing).not.toHaveBeenCalled();

      expect(postsRepository.like).toHaveBeenCalledWith('post-1', 'author-1');
    });

    it('rejects non-follower from liking FOLLOWERS_ONLY post', async () => {
      postsRepository.findPostForInteraction.mockResolvedValue({
        id: 'post-1',
        authorId: 'author-1',
        status: 'PUBLISHED',
        visibility: 'FOLLOWERS_ONLY',
        deletedAt: null,
      });

      followsService.isFollowing.mockResolvedValue({
        following: false,
      });

      await expect(service.like('post-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );

      expect(postsRepository.like).not.toHaveBeenCalled();

      expect(userInterestService.recordPostInteraction).not.toHaveBeenCalled();
    });

    it('rejects liking private post', async () => {
      postsRepository.findPostForInteraction.mockResolvedValue({
        id: 'post-1',
        authorId: 'author-1',
        status: 'PUBLISHED',
        visibility: 'PRIVATE',
        deletedAt: null,
      });

      await expect(service.like('post-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );

      expect(postsRepository.like).not.toHaveBeenCalled();
    });

    it('rejects liking non-published post', async () => {
      postsRepository.findPostForInteraction.mockResolvedValue({
        id: 'post-1',
        authorId: 'author-1',
        status: 'DRAFT',
        visibility: 'PUBLIC',
        deletedAt: null,
      });

      await expect(service.like('post-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );

      expect(postsRepository.like).not.toHaveBeenCalled();
    });

    it('rejects liking deleted post', async () => {
      postsRepository.findPostForInteraction.mockResolvedValue({
        id: 'post-1',
        authorId: 'author-1',
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        deletedAt: new Date(),
      });

      await expect(service.like('post-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );

      expect(postsRepository.like).not.toHaveBeenCalled();
    });
  });

  describe('unlike', () => {
    it('unlikes post and records UNLIKE when state changed', async () => {
      postsRepository.findPostForInteraction.mockResolvedValue({
        id: 'post-1',
        authorId: 'author-1',
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        deletedAt: null,
      });

      postsRepository.unlike.mockResolvedValue({
        liked: false,
        likeCount: 9,
        changed: true,
      });

      const result = await service.unlike('post-1', 'user-1');

      expect(postsRepository.unlike).toHaveBeenCalledWith('post-1', 'user-1');

      expect(userInterestService.recordPostInteraction).toHaveBeenCalledWith(
        'user-1',
        'post-1',
        'UNLIKE',
      );

      expect(result).toEqual({
        liked: false,
        likeCount: 9,
      });
    });

    it('does not record UNLIKE when state did not change', async () => {
      postsRepository.findPostForInteraction.mockResolvedValue({
        id: 'post-1',
        authorId: 'author-1',
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        deletedAt: null,
      });

      postsRepository.unlike.mockResolvedValue({
        liked: false,
        likeCount: 9,
        changed: false,
      });

      await service.unlike('post-1', 'user-1');

      expect(userInterestService.recordPostInteraction).not.toHaveBeenCalled();
    });

    it('rejects unlike when post is inaccessible', async () => {
      postsRepository.findPostForInteraction.mockResolvedValue({
        id: 'post-1',
        authorId: 'author-1',
        status: 'PUBLISHED',
        visibility: 'FOLLOWERS_ONLY',
        deletedAt: null,
      });

      followsService.isFollowing.mockResolvedValue({
        following: false,
      });

      await expect(service.unlike('post-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );

      expect(postsRepository.unlike).not.toHaveBeenCalled();

      expect(userInterestService.recordPostInteraction).not.toHaveBeenCalled();
    });
  });
});
