jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('../../follows/follows.service', () => ({
  FollowsService: class {},
}));
import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { PostsRepository } from '../posts.repository';
import { PostSaveRepository, type SavedPostRow } from './post-save.repository';
import { FollowsService } from '../../follows/follows.service';
import { PostSaveService } from './post-save.service';
import { PostVisibilityService } from '../../post-visibility/post-visibility.service';
import { decodeSavedPostCursor } from './saved-post-cursor.util';

describe('PostSaveService', () => {
  const repository: jest.Mocked<
    Pick<PostSaveRepository, 'save' | 'unsave' | 'findSavedPage'>
  > = {
    save: jest.fn(),
    unsave: jest.fn(),
    findSavedPage: jest.fn(),
  };
  const prisma = { user: { findUnique: jest.fn() } };
  const posts = { findPostForInteraction: jest.fn() };
  const follows = { isFollowing: jest.fn() };
  let service: PostSaveService;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PostSaveService,
        PostVisibilityService,
        { provide: PostSaveRepository, useValue: repository },
        { provide: PrismaService, useValue: prisma },
        { provide: PostsRepository, useValue: posts },
        { provide: FollowsService, useValue: follows },
      ],
    }).compile();
    service = module.get(PostSaveService);
  });
  function savedRow(postId: string, savedAt: Date): SavedPostRow {
    return {
      postId,
      createdAt: savedAt,
      post: {
        id: postId,
        authorId: 'author',
        gameId: 'game',
        categoryId: null,
        title: 'Saved post',
        content: 'Content',
        type: 'GENERAL',
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        isSpoiler: false,
        viewCount: 0,
        commentCount: 0,
        reactionCount: 0,
        saveCount: 0,
        shareCount: 0,
        createdAt: savedAt,
        updatedAt: savedAt,
        deletedAt: null,
        author: { id: 'author', name: 'Author', image: null },
        game: { id: 'game', name: 'Game', slug: 'game', iconUrl: null },
        category: null,
        media: [],
        tags: [],
        postLikes: [],
        postSaves: [{ userId: 'viewer' }],
      },
    };
  }
  const post = {
    id: 'post',
    authorId: 'author',
    status: 'PUBLISHED',
    visibility: 'PUBLIC',
    deletedAt: null,
  };
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({
      id: 'viewer',
      status: 'ACTIVE',
      role: 'USER',
    });
    posts.findPostForInteraction.mockResolvedValue(post);
    follows.isFollowing.mockResolvedValue({ following: false });
    repository.save.mockResolvedValue({ saved: true });
    repository.unsave.mockResolvedValue({ saved: false });
    repository.findSavedPage.mockResolvedValue([]);
  });
  it.each(['save', 'unsave', 'list'] as const)(
    'rejects inactive users for %s',
    async (method) => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'viewer',
        status: 'SUSPENDED',
      });
      const result =
        method === 'list'
          ? service.list('viewer', {})
          : service[method]('viewer', 'post');
      await expect(result).rejects.toThrow(ForbiddenException);
      expect(repository.save).not.toHaveBeenCalled();
      expect(repository.unsave).not.toHaveBeenCalled();
      expect(repository.findSavedPage).not.toHaveBeenCalled();
    },
  );
  it('rejects missing session accounts', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.save('viewer', 'post')).rejects.toThrow(
      UnauthorizedException,
    );
  });
  it('saves accessible posts as the active session user, including repeated saves', async () => {
    await expect(service.save('viewer', 'post')).resolves.toEqual({
      saved: true,
    });
    await expect(service.save('viewer', 'post')).resolves.toEqual({
      saved: true,
    });
    expect(repository.save).toHaveBeenCalledWith('viewer', 'post');
  });
  it.each([
    null,
    { ...post, status: 'DRAFT' },
    { ...post, status: 'HIDDEN' },
    { ...post, status: 'DELETED' },
    { ...post, deletedAt: new Date() },
    { ...post, visibility: 'PRIVATE' },
    { ...post, visibility: 'FOLLOWERS_ONLY' },
  ])('conceals unavailable posts %#', async (unavailable) => {
    posts.findPostForInteraction.mockResolvedValue(unavailable);
    await expect(service.save('viewer', 'post')).rejects.toThrow(
      NotFoundException,
    );
    expect(repository.save).not.toHaveBeenCalled();
  });
  it('permits followers-only posts for followers and the author', async () => {
    posts.findPostForInteraction.mockResolvedValue({
      ...post,
      visibility: 'FOLLOWERS_ONLY',
    });
    follows.isFollowing.mockResolvedValue({ following: true });
    await expect(service.save('viewer', 'post')).resolves.toEqual({
      saved: true,
    });
    expect(follows.isFollowing).toHaveBeenCalledWith('viewer', 'author');
    follows.isFollowing.mockClear();
    prisma.user.findUnique.mockResolvedValue({
      id: 'author',
      status: 'ACTIVE',
    });
    await service.save('author', 'post');
    expect(follows.isFollowing).not.toHaveBeenCalled();
  });
  it('unsaves repeatedly without resolving existence or visibility', async () => {
    posts.findPostForInteraction.mockResolvedValue(null);
    await expect(service.unsave('viewer', 'post')).resolves.toEqual({
      saved: false,
    });
    await expect(service.unsave('viewer', 'post')).resolves.toEqual({
      saved: false,
    });
    expect(repository.unsave).toHaveBeenCalledWith('viewer', 'post');
    expect(posts.findPostForInteraction).not.toHaveBeenCalled();
    expect(follows.isFollowing).not.toHaveBeenCalled();
  });
  it('requests limit + 1, trims the sentinel, and uses the last returned save as cursor', async () => {
    const savedAt = new Date('2026-10-06T00:00:00.000Z');
    const rows = ['c', 'b', 'a'].map((postId) => savedRow(postId, savedAt));
    repository.findSavedPage.mockResolvedValue(rows);
    const result = await service.list('viewer', { limit: 2 });
    expect(repository.findSavedPage).toHaveBeenCalledWith(
      'viewer',
      3,
      undefined,
    );
    expect(result.items.map((item) => item.id)).toEqual(['c', 'b']);
    expect(result.items[0]).toMatchObject({
      savedAt,
      savedByCurrentUser: true,
    });
    expect(result.hasMore).toBe(true);
    if (result.nextCursor === null)
      throw new Error('Expected continuation cursor');
    expect(decodeSavedPostCursor(result.nextCursor)).toEqual({
      savedAt,
      postId: 'b',
    });
    await service.list('viewer', { limit: 2, cursor: result.nextCursor });
    expect(repository.findSavedPage).toHaveBeenLastCalledWith('viewer', 3, {
      savedAt,
      postId: 'b',
    });
  });
  it.each([0, 1, 2])(
    'has no next cursor when %s rows fit the limit',
    async (count) => {
      repository.findSavedPage.mockResolvedValue(
        Array.from({ length: count }, () => savedRow('post', new Date())),
      );
      expect(await service.list('viewer', { limit: 2 })).toMatchObject({
        hasMore: false,
        nextCursor: null,
      });
    },
  );
  it('uses default limit and rejects malformed cursors before querying', async () => {
    await service.list('viewer', {});
    expect(repository.findSavedPage).toHaveBeenCalledWith(
      'viewer',
      21,
      undefined,
    );
    repository.findSavedPage.mockClear();
    await expect(service.list('viewer', { cursor: '' })).rejects.toThrow(
      BadRequestException,
    );
    expect(repository.findSavedPage).not.toHaveBeenCalled();
  });
});
