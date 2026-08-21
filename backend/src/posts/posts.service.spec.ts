import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { MediaService } from '../media/media.service';
import type { PostsRepository } from './posts.repository';
import type { FollowsService } from '../follows/follows.service';
import { PostTypeDto } from './dto/create-post.dto';
import { PostSortDto } from './dto/query-posts.dto';

jest.mock('./posts.repository', () => ({
  PostsRepository: class {},
}));

jest.mock('../media/media.service', () => ({
  MediaService: class {},
}));

jest.mock('../follows/follows.service', () => ({
  FollowsService: class {},
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
    findById: jest.fn(),
    create: jest.fn(),
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

  let service: PostsService;

  const basePost = {
    id: 'post-1',
    authorId: 'user-1',
    gameId: 'game-1',
    categoryId: null,
    title: 'Test Post',
    content: 'Test Content',
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
    tags: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();

    service = new PostsService(
      postsRepository as unknown as PostsRepository,
      mediaService as unknown as MediaService,
      followsService as unknown as FollowsService,
    );
  });

  describe('findAll', () => {
    it('lists posts with default pagination', async () => {
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

      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
    });

    it('uses provided pagination', async () => {
      postsRepository.findMany.mockResolvedValue([]);
      postsRepository.count.mockResolvedValue(25);

      const result = await service.findAll({
        page: 2,
        limit: 10,
      });

      expect(postsRepository.findMany).toHaveBeenCalledWith({
        where: {
          status: 'PUBLISHED',
          visibility: 'PUBLIC',
          deletedAt: null,
        },
        skip: 10,
        take: 10,
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

      expect(result.meta).toEqual({
        page: 2,
        limit: 10,
        total: 25,
        totalPages: 3,
      });
    });

    it('filters posts by game slug', async () => {
      postsRepository.findMany.mockResolvedValue([]);
      postsRepository.count.mockResolvedValue(0);

      await service.findAll({
        gameSlug: 'wuthering-waves',
      });

      expect(postsRepository.findMany).toHaveBeenCalledWith({
        where: {
          status: 'PUBLISHED',
          visibility: 'PUBLIC',
          deletedAt: null,
          game: {
            slug: 'wuthering-waves',
            status: 'ACTIVE',
          },
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
    });

    it('filters posts by category slug', async () => {
      postsRepository.findMany.mockResolvedValue([]);
      postsRepository.count.mockResolvedValue(0);

      await service.findAll({
        categorySlug: 'builds',
      });

      expect(postsRepository.findMany).toHaveBeenCalledWith({
        where: {
          status: 'PUBLISHED',
          visibility: 'PUBLIC',
          deletedAt: null,
          category: {
            slug: 'builds',
            isActive: true,
          },
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
    });

    it('filters posts by type', async () => {
      postsRepository.findMany.mockResolvedValue([]);
      postsRepository.count.mockResolvedValue(0);

      await service.findAll({
        type: PostTypeDto.GUIDE,
      });

      expect(postsRepository.findMany).toHaveBeenCalledWith({
        where: {
          status: 'PUBLISHED',
          visibility: 'PUBLIC',
          deletedAt: null,
          type: PostTypeDto.GUIDE,
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
    });

    it('searches title, content and tags', async () => {
      postsRepository.findMany.mockResolvedValue([]);
      postsRepository.count.mockResolvedValue(0);

      await service.findAll({
        search: 'Jinhsi',
      });

      expect(postsRepository.findMany).toHaveBeenCalledWith({
        where: {
          status: 'PUBLISHED',
          visibility: 'PUBLIC',
          deletedAt: null,
          OR: [
            {
              title: {
                contains: 'Jinhsi',
                mode: 'insensitive',
              },
            },
            {
              content: {
                contains: 'Jinhsi',
                mode: 'insensitive',
              },
            },
            {
              tags: {
                some: {
                  tag: {
                    name: {
                      contains: 'Jinhsi',
                      mode: 'insensitive',
                    },
                  },
                },
              },
            },
          ],
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
    });

    it('uses popular sorting', async () => {
      postsRepository.findMany.mockResolvedValue([]);
      postsRepository.count.mockResolvedValue(0);

      await service.findAll({
        sort: PostSortDto.POPULAR,
      });

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
        userId: undefined,
      });
    });

    it('passes current user id for liked state', async () => {
      postsRepository.findMany.mockResolvedValue([]);
      postsRepository.count.mockResolvedValue(0);

      await service.findAll({}, 'user-1');

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
        userId: 'user-1',
      });
    });

    it('formats tags and liked state', async () => {
      postsRepository.findMany.mockResolvedValue([
        {
          ...basePost,
          tags: [
            {
              tag: {
                id: 'tag-1',
                name: 'Guide',
                slug: 'guide',
              },
            },
          ],
          postLikes: [
            {
              userId: 'user-1',
            },
          ],
        },
      ]);

      postsRepository.count.mockResolvedValue(1);

      const result = await service.findAll({}, 'user-1');

      expect(result.items[0].tags).toEqual([
        {
          id: 'tag-1',
          name: 'Guide',
          slug: 'guide',
        },
      ]);

      expect(result.items[0].likedByCurrentUser).toBe(true);
    });
  });

  describe('findOne', () => {
    it('returns a published post', async () => {
      postsRepository.findPublishedById.mockResolvedValue({
        ...basePost,
        postLikes: [],
      });

      const result = await service.findOne('post-1', 'user-1');

      expect(postsRepository.findPublishedById).toHaveBeenCalledWith(
        'post-1',
        'user-1',
      );

      expect(result.id).toBe('post-1');
      expect(result.likedByCurrentUser).toBe(false);
    });

    it('throws when post does not exist', async () => {
      postsRepository.findPublishedById.mockResolvedValue(null);

      await expect(service.findOne('missing-post')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByAuthor', () => {
    it('lists posts belonging to current author', async () => {
      postsRepository.findByAuthorId.mockResolvedValue({
        items: [basePost],
        total: 1,
      });

      const result = await service.findByAuthor({}, 'user-1');

      expect(postsRepository.findByAuthorId).toHaveBeenCalledWith('user-1', {
        page: 1,
        limit: 20,
      });

      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
    });
  });

  describe('findByAuthorPublic', () => {
    it('only requests published public posts', async () => {
      postsRepository.findByAuthorId.mockResolvedValue({
        items: [basePost],
        total: 1,
      });

      await service.findByAuthorPublic({}, 'user-1');

      expect(postsRepository.findByAuthorId).toHaveBeenCalledWith('user-1', {
        page: 1,
        limit: 20,
        visibility: 'PUBLIC',
        status: 'PUBLISHED',
      });
    });
  });

  describe('create', () => {
    it('throws when active game does not exist', async () => {
      postsRepository.findGameById.mockResolvedValue(null);

      await expect(
        service.create(
          {
            gameId: 'game-1',
            title: 'Test Post',
            content: 'Content',
          },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);

      expect(mediaService.getAttachableUploads).not.toHaveBeenCalled();

      expect(postsRepository.create).not.toHaveBeenCalled();
    });

    it('throws when game is inactive', async () => {
      postsRepository.findGameById.mockResolvedValue({
        id: 'game-1',
        status: 'ARCHIVED',
      });

      await expect(
        service.create(
          {
            gameId: 'game-1',
            title: 'Test Post',
            content: 'Content',
          },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);

      expect(postsRepository.create).not.toHaveBeenCalled();
    });

    it('throws when category does not belong to selected game', async () => {
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
            title: 'Test Post',
            content: 'Content',
          },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);

      expect(postsRepository.create).not.toHaveBeenCalled();
    });

    it('creates a text-only post', async () => {
      postsRepository.findGameById.mockResolvedValue({
        id: 'game-1',
        status: 'ACTIVE',
      });

      mediaService.getAttachableUploads.mockResolvedValue([]);

      postsRepository.create.mockResolvedValue({
        ...basePost,
        title: 'Test Post',
        content: 'Content',
        tags: [],
      });

      const result = await service.create(
        {
          gameId: 'game-1',
          title: '  Test Post  ',
          content: '  Content  ',
        },
        'user-1',
      );

      expect(mediaService.getAttachableUploads).toHaveBeenCalledWith({
        ids: [],
        userId: 'user-1',
        purpose: 'POST',
      });

      expect(postsRepository.create).toHaveBeenCalledWith({
        authorId: 'user-1',
        gameId: 'game-1',
        categoryId: undefined,
        title: 'Test Post',
        content: 'Content',
        type: undefined,
        status: undefined,
        visibility: undefined,
        isSpoiler: undefined,
        media: [],
        tags: undefined,
      });

      expect(result.id).toBe('post-1');
    });

    it('creates post with image media', async () => {
      postsRepository.findGameById.mockResolvedValue({
        id: 'game-1',
        status: 'ACTIVE',
      });

      mediaService.getAttachableUploads.mockResolvedValue([
        {
          id: 'upload-1',
          assetId: 'asset-1',
          publicId: 'gachahub/post/image-1',
          secureUrl: 'https://example.com/image.jpg',
          resourceType: 'IMAGE',
          format: 'jpg',
          width: 1080,
          height: 1080,
          duration: null,
          bytes: 1000,
        },
      ]);

      postsRepository.create.mockResolvedValue({
        ...basePost,
        tags: [],
      });

      await service.create(
        {
          gameId: 'game-1',
          title: 'Image Post',
          content: 'Content',
          media: [
            {
              mediaUploadId: 'upload-1',
              altText: 'Test image',
              sortOrder: 0,
            },
          ],
        },
        'user-1',
      );

      expect(postsRepository.create).toHaveBeenCalledWith({
        authorId: 'user-1',
        gameId: 'game-1',
        categoryId: undefined,
        title: 'Image Post',
        content: 'Content',
        type: undefined,
        status: undefined,
        visibility: undefined,
        isSpoiler: undefined,
        media: [
          {
            mediaUploadId: 'upload-1',
            assetId: 'asset-1',
            publicId: 'gachahub/post/image-1',
            url: 'https://example.com/image.jpg',
            mediaType: 'IMAGE',
            altText: 'Test image',
            sortOrder: 0,
            width: 1080,
            height: 1080,
            duration: null,
            bytes: 1000,
            format: 'jpg',
          },
        ],
        tags: undefined,
      });
    });

    it('maps gif image to GIF media type', async () => {
      postsRepository.findGameById.mockResolvedValue({
        id: 'game-1',
        status: 'ACTIVE',
      });

      mediaService.getAttachableUploads.mockResolvedValue([
        {
          id: 'upload-1',
          assetId: 'asset-1',
          publicId: 'gachahub/post/gif-1',
          secureUrl: 'https://example.com/test.gif',
          resourceType: 'IMAGE',
          format: 'gif',
          width: 500,
          height: 500,
          duration: null,
          bytes: 1000,
        },
      ]);

      postsRepository.create.mockResolvedValue({
        ...basePost,
        tags: [],
      });

      await service.create(
        {
          gameId: 'game-1',
          title: 'GIF Post',
          content: 'Content',
          media: [
            {
              mediaUploadId: 'upload-1',
            },
          ],
        },
        'user-1',
      );

      expect(postsRepository.create).toHaveBeenCalledWith({
        authorId: 'user-1',
        gameId: 'game-1',
        categoryId: undefined,
        title: 'GIF Post',
        content: 'Content',
        type: undefined,
        status: undefined,
        visibility: undefined,
        isSpoiler: undefined,
        media: [
          {
            mediaUploadId: 'upload-1',
            assetId: 'asset-1',
            publicId: 'gachahub/post/gif-1',
            url: 'https://example.com/test.gif',
            mediaType: 'GIF',
            altText: undefined,
            sortOrder: 0,
            width: 500,
            height: 500,
            duration: null,
            bytes: 1000,
            format: 'gif',
          },
        ],
        tags: undefined,
      });
    });

    it('rejects more than 10 images', async () => {
      postsRepository.findGameById.mockResolvedValue({
        id: 'game-1',
        status: 'ACTIVE',
      });

      mediaService.getAttachableUploads.mockResolvedValue(
        Array.from({ length: 11 }, (_, index) => ({
          id: `upload-${index}`,
          assetId: `asset-${index}`,
          publicId: `image-${index}`,
          secureUrl: `https://example.com/${index}.jpg`,
          resourceType: 'IMAGE',
          format: 'jpg',
        })),
      );

      await expect(
        service.create(
          {
            gameId: 'game-1',
            title: 'Too many images',
            content: 'Content',
            media: Array.from({ length: 11 }, (_, index) => ({
              mediaUploadId: `upload-${index}`,
            })),
          },
          'user-1',
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
            title: 'Videos',
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
          'user-1',
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
            title: 'Mixed media',
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
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(postsRepository.create).not.toHaveBeenCalled();
    });

    it('normalizes and removes duplicate tags', async () => {
      postsRepository.findGameById.mockResolvedValue({
        id: 'game-1',
        status: 'ACTIVE',
      });

      mediaService.getAttachableUploads.mockResolvedValue([]);

      postsRepository.create.mockResolvedValue({
        ...basePost,
        tags: [],
      });

      await service.create(
        {
          gameId: 'game-1',
          title: 'Tags',
          content: 'Content',
          tags: [' Build ', 'build', 'Team Guide'],
        },
        'user-1',
      );

      expect(postsRepository.create).toHaveBeenCalledWith({
        authorId: 'user-1',
        gameId: 'game-1',
        categoryId: undefined,
        title: 'Tags',
        content: 'Content',
        type: undefined,
        status: undefined,
        visibility: undefined,
        isSpoiler: undefined,
        media: [],
        tags: [
          {
            name: 'build',
            slug: 'build',
          },
          {
            name: 'Team Guide',
            slug: 'team-guide',
          },
        ],
      });
    });
  });

  describe('update', () => {
    it('throws when post does not exist', async () => {
      postsRepository.findById.mockResolvedValue(null);

      await expect(
        service.update(
          'missing-post',
          {
            title: 'Updated',
          },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);

      expect(postsRepository.update).not.toHaveBeenCalled();
    });

    it('throws when post is deleted', async () => {
      postsRepository.findById.mockResolvedValue({
        ...basePost,
        status: 'DELETED',
      });

      await expect(
        service.update(
          'post-1',
          {
            title: 'Updated',
          },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);

      expect(postsRepository.update).not.toHaveBeenCalled();
    });

    it('rejects updating another user post', async () => {
      postsRepository.findById.mockResolvedValue({
        ...basePost,
        authorId: 'user-2',
      });

      await expect(
        service.update(
          'post-1',
          {
            title: 'Updated',
          },
          'user-1',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(postsRepository.update).not.toHaveBeenCalled();
    });

    it('rejects category from another game', async () => {
      postsRepository.findById.mockResolvedValue(basePost);

      postsRepository.findCategoryById.mockResolvedValue({
        id: 'category-1',
        gameId: 'game-2',
        isActive: true,
      });

      await expect(
        service.update(
          'post-1',
          {
            categoryId: 'category-1',
          },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);

      expect(postsRepository.update).not.toHaveBeenCalled();
    });

    it('updates and trims title and content', async () => {
      postsRepository.findById.mockResolvedValue(basePost);

      postsRepository.update.mockResolvedValue({
        ...basePost,
        title: 'Updated title',
        content: 'Updated content',
        tags: [],
      });

      const result = await service.update(
        'post-1',
        {
          title: '  Updated title  ',
          content: '  Updated content  ',
        },
        'user-1',
      );

      expect(postsRepository.update).toHaveBeenCalledWith({
        id: 'post-1',
        data: {
          title: 'Updated title',
          content: 'Updated content',
        },
        tags: undefined,
      });

      expect(result.title).toBe('Updated title');
      expect(result.content).toBe('Updated content');
    });

    it('connects a new category', async () => {
      postsRepository.findById.mockResolvedValue(basePost);

      postsRepository.findCategoryById.mockResolvedValue({
        id: 'category-1',
        gameId: 'game-1',
        isActive: true,
      });

      postsRepository.update.mockResolvedValue({
        ...basePost,
        categoryId: 'category-1',
        tags: [],
      });

      await service.update(
        'post-1',
        {
          categoryId: 'category-1',
        },
        'user-1',
      );

      expect(postsRepository.update).toHaveBeenCalledWith({
        id: 'post-1',
        data: {
          category: {
            connect: {
              id: 'category-1',
            },
          },
        },
        tags: undefined,
      });
    });
  });

  describe('remove', () => {
    it('throws when post does not exist', async () => {
      postsRepository.findById.mockResolvedValue(null);

      await expect(service.remove('missing-post', 'user-1')).rejects.toThrow(
        NotFoundException,
      );

      expect(postsRepository.softDelete).not.toHaveBeenCalled();
    });

    it('throws when post is already deleted', async () => {
      postsRepository.findById.mockResolvedValue({
        ...basePost,
        status: 'DELETED',
      });

      await expect(service.remove('post-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects deleting another user post', async () => {
      postsRepository.findById.mockResolvedValue({
        ...basePost,
        authorId: 'user-2',
      });

      await expect(service.remove('post-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );

      expect(postsRepository.softDelete).not.toHaveBeenCalled();
    });

    it('soft deletes own published post', async () => {
      postsRepository.findById.mockResolvedValue(basePost);

      postsRepository.softDelete.mockResolvedValue({
        ...basePost,
        status: 'DELETED',
      });

      const result = await service.remove('post-1', 'user-1');

      expect(postsRepository.softDelete).toHaveBeenCalledWith('post-1');

      expect(result).toEqual({
        message: 'Post deleted successfully',
      });
    });

    it('soft deletes own draft post', async () => {
      postsRepository.findById.mockResolvedValue({
        ...basePost,
        status: 'DRAFT',
      });

      postsRepository.softDelete.mockResolvedValue({});

      await service.remove('post-1', 'user-1');

      expect(postsRepository.softDelete).toHaveBeenCalledWith('post-1');
    });
  });

  describe('like', () => {
    it('likes an existing post', async () => {
      postsRepository.findPostForInteraction.mockResolvedValue({
        id: 'post-1',
        authorId: 'user-1',
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        deletedAt: null,
      });

      postsRepository.like.mockResolvedValue({
        liked: true,
        likeCount: 1,
      });

      const result = await service.like('post-1', 'user-1');

      expect(postsRepository.like).toHaveBeenCalledWith('post-1', 'user-1');

      expect(result).toEqual({
        liked: true,
        likeCount: 1,
      });
    });

    it('throws when liking missing post', async () => {
      postsRepository.findPostForInteraction.mockResolvedValue(null);

      await expect(service.like('missing-post', 'user-1')).rejects.toThrow(
        NotFoundException,
      );

      expect(postsRepository.like).not.toHaveBeenCalled();
    });
  });

  describe('unlike', () => {
    it('unlikes an existing post', async () => {
      postsRepository.findPostForInteraction.mockResolvedValue({
        id: 'post-1',
        authorId: 'user-1',
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        deletedAt: null,
      });

      postsRepository.unlike.mockResolvedValue({
        liked: false,
        likeCount: 0,
      });

      const result = await service.unlike('post-1', 'user-1');

      expect(postsRepository.unlike).toHaveBeenCalledWith('post-1', 'user-1');

      expect(result).toEqual({
        liked: false,
        likeCount: 0,
      });
    });

    it('throws when unliking missing post', async () => {
      postsRepository.findPostForInteraction.mockResolvedValue(null);

      await expect(service.unlike('missing-post', 'user-1')).rejects.toThrow(
        NotFoundException,
      );

      expect(postsRepository.unlike).not.toHaveBeenCalled();
    });
  });
});
