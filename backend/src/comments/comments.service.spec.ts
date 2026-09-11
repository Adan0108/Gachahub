import { ForbiddenException, NotFoundException } from '@nestjs/common';

import type { CommentsRepository } from './comments.repository';
import type { FollowsService } from '../follows/follows.service';
import type { UserInterestService } from '../recommendation/user-interest.service';

/*
 * These dependencies are mocked at module level so Jest does not load their
 * real implementations and transitively initialise Prisma.
 */
jest.mock('./comments.repository', () => ({
  CommentsRepository: class {},
}));

jest.mock('../follows/follows.service', () => ({
  FollowsService: class {},
}));

jest.mock('../recommendation/user-interest.service', () => ({
  UserInterestService: class {},
}));

import { CommentsService } from './comments.service';

describe('CommentsService', () => {
  const commentsRepository = {
    findPostById: jest.fn(),
    findById: jest.fn(),
    findByPostId: jest.fn(),
    findReplies: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
  };

  const followsService = {
    isFollowing: jest.fn(),
  };

  const userInterestService = {
    recordPostInteraction: jest.fn(),
  };

  let service: CommentsService;

  beforeEach(() => {
    jest.clearAllMocks();

    service = new CommentsService(
      commentsRepository as unknown as CommentsRepository,
      followsService as unknown as FollowsService,
      userInterestService as unknown as UserInterestService,
    );
  });

  describe('findByPost', () => {
    it('lists comments with default pagination', async () => {
      commentsRepository.findPostById.mockResolvedValue({
        id: 'post-1',
        authorId: 'author-1',
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        deletedAt: null,
      });

      commentsRepository.findByPostId.mockResolvedValue({
        items: [
          {
            id: 'comment-1',
            postId: 'post-1',
            authorId: 'user-1',
            parentId: null,
            content: 'Nice post',
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
            author: {
              id: 'user-1',
              name: 'User 1',
              image: null,
            },
            _count: {
              replies: 2,
            },
          },
        ],
        total: 1,
      });

      const result = await service.findByPost('post-1', {});

      expect(commentsRepository.findPostById).toHaveBeenCalledWith('post-1');

      expect(commentsRepository.findByPostId).toHaveBeenCalledWith('post-1', {
        page: 1,
        limit: 20,
      });

      expect(result.items[0]).toEqual(
        expect.objectContaining({
          id: 'comment-1',
          content: 'Nice post',
          replyCount: 2,
        }),
      );

      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
    });

    it('uses provided pagination', async () => {
      commentsRepository.findPostById.mockResolvedValue({
        id: 'post-1',
        authorId: 'author-1',
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        deletedAt: null,
      });

      commentsRepository.findByPostId.mockResolvedValue({
        items: [],
        total: 25,
      });

      const result = await service.findByPost('post-1', {
        page: 2,
        limit: 10,
      });

      expect(commentsRepository.findByPostId).toHaveBeenCalledWith('post-1', {
        page: 2,
        limit: 10,
      });

      expect(result.meta).toEqual({
        page: 2,
        limit: 10,
        total: 25,
        totalPages: 3,
      });
    });

    it('allows follower to view FOLLOWERS_ONLY post comments', async () => {
      commentsRepository.findPostById.mockResolvedValue({
        id: 'post-1',
        authorId: 'author-1',
        status: 'PUBLISHED',
        visibility: 'FOLLOWERS_ONLY',
        deletedAt: null,
      });

      followsService.isFollowing.mockResolvedValue({
        following: true,
      });

      commentsRepository.findByPostId.mockResolvedValue({
        items: [],
        total: 0,
      });

      await service.findByPost('post-1', {}, 'user-1');

      expect(followsService.isFollowing).toHaveBeenCalledWith(
        'user-1',
        'author-1',
      );

      expect(commentsRepository.findByPostId).toHaveBeenCalled();
    });

    it('allows author to view own FOLLOWERS_ONLY post without follow lookup', async () => {
      commentsRepository.findPostById.mockResolvedValue({
        id: 'post-1',
        authorId: 'user-1',
        status: 'PUBLISHED',
        visibility: 'FOLLOWERS_ONLY',
        deletedAt: null,
      });

      commentsRepository.findByPostId.mockResolvedValue({
        items: [],
        total: 0,
      });

      await service.findByPost('post-1', {}, 'user-1');

      expect(followsService.isFollowing).not.toHaveBeenCalled();

      expect(commentsRepository.findByPostId).toHaveBeenCalled();
    });

    it('rejects non-follower from FOLLOWERS_ONLY post comments', async () => {
      commentsRepository.findPostById.mockResolvedValue({
        id: 'post-1',
        authorId: 'author-1',
        status: 'PUBLISHED',
        visibility: 'FOLLOWERS_ONLY',
        deletedAt: null,
      });

      followsService.isFollowing.mockResolvedValue({
        following: false,
      });

      await expect(service.findByPost('post-1', {}, 'user-1')).rejects.toThrow(
        NotFoundException,
      );

      expect(commentsRepository.findByPostId).not.toHaveBeenCalled();
    });

    it('throws when post does not exist', async () => {
      commentsRepository.findPostById.mockResolvedValue(null);

      await expect(service.findByPost('missing-post', {})).rejects.toThrow(
        NotFoundException,
      );

      expect(commentsRepository.findByPostId).not.toHaveBeenCalled();
    });

    it('throws when post is not published', async () => {
      commentsRepository.findPostById.mockResolvedValue({
        id: 'post-1',
        authorId: 'author-1',
        status: 'DRAFT',
        visibility: 'PUBLIC',
        deletedAt: null,
      });

      await expect(service.findByPost('post-1', {})).rejects.toThrow(
        NotFoundException,
      );

      expect(commentsRepository.findByPostId).not.toHaveBeenCalled();
    });

    it('throws when post is private', async () => {
      commentsRepository.findPostById.mockResolvedValue({
        id: 'post-1',
        authorId: 'author-1',
        status: 'PUBLISHED',
        visibility: 'PRIVATE',
        deletedAt: null,
      });

      await expect(service.findByPost('post-1', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws when post is deleted', async () => {
      commentsRepository.findPostById.mockResolvedValue({
        id: 'post-1',
        authorId: 'author-1',
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        deletedAt: new Date(),
      });

      await expect(service.findByPost('post-1', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('hides deleted comment content but preserves reply count', async () => {
      commentsRepository.findPostById.mockResolvedValue({
        id: 'post-1',
        authorId: 'author-1',
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        deletedAt: null,
      });

      commentsRepository.findByPostId.mockResolvedValue({
        items: [
          {
            id: 'comment-1',
            postId: 'post-1',
            authorId: 'user-1',
            parentId: null,
            content: 'Original deleted content',
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: new Date(),
            author: {
              id: 'user-1',
              name: 'User 1',
              image: null,
            },
            _count: {
              replies: 2,
            },
          },
        ],
        total: 1,
      });

      const result = await service.findByPost('post-1', {});

      expect(result.items[0].content).toBeNull();

      expect(result.items[0].replyCount).toBe(2);
    });
  });

  describe('create', () => {
    it('creates comment and records COMMENT interest', async () => {
      commentsRepository.findPostById.mockResolvedValue({
        id: 'post-1',
        authorId: 'author-1',
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        deletedAt: null,
      });

      commentsRepository.create.mockResolvedValue({
        id: 'comment-1',
        postId: 'post-1',
        authorId: 'user-1',
        parentId: null,
        content: 'Nice post',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        author: {
          id: 'user-1',
          name: 'User 1',
          image: null,
        },
      });

      const result = await service.create(
        'post-1',
        {
          content: '  Nice post  ',
        },
        'user-1',
      );

      expect(commentsRepository.create).toHaveBeenCalledWith({
        postId: 'post-1',
        authorId: 'user-1',
        content: 'Nice post',
      });

      expect(userInterestService.recordPostInteraction).toHaveBeenCalledWith(
        'user-1',
        'post-1',
        'COMMENT',
      );

      expect(result).toEqual(
        expect.objectContaining({
          id: 'comment-1',
          content: 'Nice post',
          replyCount: 0,
        }),
      );
    });

    it('does not record interest when comment creation fails', async () => {
      commentsRepository.findPostById.mockResolvedValue({
        id: 'post-1',
        authorId: 'author-1',
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        deletedAt: null,
      });

      commentsRepository.create.mockRejectedValue(new Error('Database error'));

      await expect(
        service.create(
          'post-1',
          {
            content: 'Hello',
          },
          'user-1',
        ),
      ).rejects.toThrow('Database error');

      expect(userInterestService.recordPostInteraction).not.toHaveBeenCalled();
    });

    it('does not create comment when post is unavailable', async () => {
      commentsRepository.findPostById.mockResolvedValue(null);

      await expect(
        service.create(
          'missing-post',
          {
            content: 'Hello',
          },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);

      expect(commentsRepository.create).not.toHaveBeenCalled();

      expect(userInterestService.recordPostInteraction).not.toHaveBeenCalled();
    });
  });

  describe('findReplies', () => {
    it('lists replies with default pagination', async () => {
      commentsRepository.findById.mockResolvedValue({
        id: 'comment-1',
        postId: 'post-1',
        authorId: 'user-1',
        parentId: null,
        content: 'Parent comment',
        deletedAt: null,
      });

      commentsRepository.findPostById.mockResolvedValue({
        id: 'post-1',
        authorId: 'author-1',
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        deletedAt: null,
      });

      commentsRepository.findReplies.mockResolvedValue({
        items: [
          {
            id: 'reply-1',
            postId: 'post-1',
            authorId: 'user-2',
            parentId: 'comment-1',
            content: 'Reply',
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
            author: {
              id: 'user-2',
              name: 'User 2',
              image: null,
            },
          },
        ],
        total: 1,
      });

      const result = await service.findReplies('comment-1', {});

      expect(commentsRepository.findReplies).toHaveBeenCalledWith('comment-1', {
        page: 1,
        limit: 20,
      });

      expect(result.items[0]).toEqual(
        expect.objectContaining({
          id: 'reply-1',
          content: 'Reply',
          replyCount: 0,
        }),
      );

      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
    });

    it('throws when parent comment does not exist', async () => {
      commentsRepository.findById.mockResolvedValue(null);

      await expect(service.findReplies('missing-comment', {})).rejects.toThrow(
        NotFoundException,
      );

      expect(commentsRepository.findReplies).not.toHaveBeenCalled();
    });

    it('rejects fetching replies from a reply', async () => {
      commentsRepository.findById.mockResolvedValue({
        id: 'reply-1',
        postId: 'post-1',
        authorId: 'user-1',
        parentId: 'comment-1',
        content: 'Reply',
        deletedAt: null,
      });

      await expect(service.findReplies('reply-1', {})).rejects.toThrow(
        NotFoundException,
      );

      expect(commentsRepository.findReplies).not.toHaveBeenCalled();
    });
  });

  describe('reply', () => {
    it('creates reply and records COMMENT interest', async () => {
      commentsRepository.findById.mockResolvedValue({
        id: 'comment-1',
        postId: 'post-1',
        authorId: 'user-2',
        parentId: null,
        content: 'Original comment',
        deletedAt: null,
      });

      commentsRepository.findPostById.mockResolvedValue({
        id: 'post-1',
        authorId: 'author-1',
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        deletedAt: null,
      });

      commentsRepository.create.mockResolvedValue({
        id: 'reply-1',
        postId: 'post-1',
        authorId: 'user-1',
        parentId: 'comment-1',
        content: 'I agree',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        author: {
          id: 'user-1',
          name: 'User 1',
          image: null,
        },
      });

      const result = await service.reply(
        'comment-1',
        {
          content: '  I agree  ',
        },
        'user-1',
      );

      expect(commentsRepository.create).toHaveBeenCalledWith({
        postId: 'post-1',
        authorId: 'user-1',
        parentId: 'comment-1',
        content: 'I agree',
      });

      expect(userInterestService.recordPostInteraction).toHaveBeenCalledWith(
        'user-1',
        'post-1',
        'COMMENT',
      );

      expect(result).toEqual(
        expect.objectContaining({
          id: 'reply-1',
          content: 'I agree',
        }),
      );
    });

    it('rejects replying to a reply', async () => {
      commentsRepository.findById.mockResolvedValue({
        id: 'reply-1',
        postId: 'post-1',
        authorId: 'user-2',
        parentId: 'comment-1',
        content: 'Already a reply',
        deletedAt: null,
      });

      await expect(
        service.reply(
          'reply-1',
          {
            content: 'Nested reply',
          },
          'user-1',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(commentsRepository.create).not.toHaveBeenCalled();

      expect(userInterestService.recordPostInteraction).not.toHaveBeenCalled();
    });

    it('rejects replying to deleted comment', async () => {
      commentsRepository.findById.mockResolvedValue({
        id: 'comment-1',
        postId: 'post-1',
        authorId: 'user-2',
        parentId: null,
        content: 'Deleted comment',
        deletedAt: new Date(),
      });

      await expect(
        service.reply(
          'comment-1',
          {
            content: 'Reply',
          },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);

      expect(commentsRepository.create).not.toHaveBeenCalled();

      expect(userInterestService.recordPostInteraction).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates own comment without recording new interest', async () => {
      commentsRepository.findById.mockResolvedValue({
        id: 'comment-1',
        postId: 'post-1',
        authorId: 'user-1',
        parentId: null,
        content: 'Old content',
        deletedAt: null,
      });

      commentsRepository.update.mockResolvedValue({
        id: 'comment-1',
        postId: 'post-1',
        authorId: 'user-1',
        parentId: null,
        content: 'Updated content',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        author: {
          id: 'user-1',
          name: 'User 1',
          image: null,
        },
      });

      const result = await service.update(
        'comment-1',
        {
          content: '  Updated content  ',
        },
        'user-1',
      );

      expect(commentsRepository.update).toHaveBeenCalledWith(
        'comment-1',
        'Updated content',
      );

      expect(userInterestService.recordPostInteraction).not.toHaveBeenCalled();

      expect(result).toEqual(
        expect.objectContaining({
          id: 'comment-1',
          content: 'Updated content',
        }),
      );
    });

    it('rejects updating another user comment', async () => {
      commentsRepository.findById.mockResolvedValue({
        id: 'comment-1',
        postId: 'post-1',
        authorId: 'user-2',
        parentId: null,
        content: 'Someone else comment',
        deletedAt: null,
      });

      await expect(
        service.update(
          'comment-1',
          {
            content: 'Changed',
          },
          'user-1',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(commentsRepository.update).not.toHaveBeenCalled();
    });

    it('rejects updating deleted comment', async () => {
      commentsRepository.findById.mockResolvedValue({
        id: 'comment-1',
        postId: 'post-1',
        authorId: 'user-1',
        parentId: null,
        content: 'Deleted',
        deletedAt: new Date(),
      });

      await expect(
        service.update(
          'comment-1',
          {
            content: 'Changed',
          },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);

      expect(commentsRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('soft deletes own comment and records COMMENT_REMOVE', async () => {
      commentsRepository.findById.mockResolvedValue({
        id: 'comment-1',
        postId: 'post-1',
        authorId: 'user-1',
        parentId: null,
        content: 'Comment',
        deletedAt: null,
      });

      commentsRepository.softDelete.mockResolvedValue({
        id: 'comment-1',
        deletedAt: new Date(),
      });

      const result = await service.remove('comment-1', 'user-1');

      expect(commentsRepository.softDelete).toHaveBeenCalledWith(
        'comment-1',
        'post-1',
      );

      expect(userInterestService.recordPostInteraction).toHaveBeenCalledWith(
        'user-1',
        'post-1',
        'COMMENT_REMOVE',
      );

      expect(result).toEqual({
        message: 'Comment deleted successfully',
      });
    });

    it('does not record COMMENT_REMOVE when soft delete changes nothing', async () => {
      commentsRepository.findById.mockResolvedValue({
        id: 'comment-1',
        postId: 'post-1',
        authorId: 'user-1',
        parentId: null,
        content: 'Comment',
        deletedAt: null,
      });

      commentsRepository.softDelete.mockResolvedValue(null);

      await service.remove('comment-1', 'user-1');

      expect(userInterestService.recordPostInteraction).not.toHaveBeenCalled();
    });

    it('rejects deleting another user comment', async () => {
      commentsRepository.findById.mockResolvedValue({
        id: 'comment-1',
        postId: 'post-1',
        authorId: 'user-2',
        parentId: null,
        content: 'Comment',
        deletedAt: null,
      });

      await expect(service.remove('comment-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );

      expect(commentsRepository.softDelete).not.toHaveBeenCalled();

      expect(userInterestService.recordPostInteraction).not.toHaveBeenCalled();
    });

    it('rejects deleting already deleted comment', async () => {
      commentsRepository.findById.mockResolvedValue({
        id: 'comment-1',
        postId: 'post-1',
        authorId: 'user-1',
        parentId: null,
        content: 'Comment',
        deletedAt: new Date(),
      });

      await expect(service.remove('comment-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );

      expect(commentsRepository.softDelete).not.toHaveBeenCalled();

      expect(userInterestService.recordPostInteraction).not.toHaveBeenCalled();
    });
  });
});
