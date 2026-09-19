import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import type { PostsRepository } from './posts.repository';
import type { GameModeratorsService } from '../game-moderators/game-moderators.service';

/*
 * Unit test only mocks service dependencies. Do not load their real
 * implementations because they eventually import Prisma.
 */
jest.mock('./posts.repository', () => ({
  PostsRepository: class {},
}));

jest.mock('../game-moderators/game-moderators.service', () => ({
  GameModeratorsService: class {},
}));

import { PostModerationService } from './post-moderation.service';

describe('PostModerationService', () => {
  const postsRepository = {
    findById: jest.fn(),
    transitionStatus: jest.fn(),
    findHiddenByGame: jest.fn(),
  };

  const gameModeratorsService = {
    resolveModeratableGameId: jest.fn(),
    loadModeratableResource: jest.fn(),
  };

  let service: PostModerationService;

  const basePost = {
    id: 'post-1',
    authorId: 'author-1',
    gameId: 'game-1',
    status: 'PUBLISHED',
    deletedAt: null,
    tags: [],
    postLikes: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    gameModeratorsService.resolveModeratableGameId.mockResolvedValue('game-1');
    // A faithful fake of GameModeratorsService.loadModeratableResource's
    // contract (load -> null or wrong game => NotFound). The real method's
    // own behavior, including authorize-before-load ordering, is covered in
    // game-moderators.service.spec.ts.
    gameModeratorsService.loadModeratableResource.mockImplementation(
      async (params: {
        notFoundMessage: string;
        load: () => Promise<{ gameId: string } | null>;
      }) => {
        const resource = await params.load();

        if (!resource || resource.gameId !== 'game-1') {
          throw new NotFoundException(params.notFoundMessage);
        }

        return { gameId: 'game-1', resource };
      },
    );

    service = new PostModerationService(
      postsRepository as unknown as PostsRepository,
      gameModeratorsService as unknown as GameModeratorsService,
    );
  });

  describe('hideAsModerator', () => {
    it('runs the shared moderation preamble for the routed game, then hides a published post', async () => {
      postsRepository.findById.mockResolvedValue(basePost);
      postsRepository.transitionStatus.mockResolvedValue({
        ...basePost,
        status: 'HIDDEN',
      });

      const result = await service.hideAsModerator(
        'wuthering-waves',
        'post-1',
        'mod-1',
      );

      expect(
        gameModeratorsService.loadModeratableResource,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          gameSlug: 'wuthering-waves',
          moderatorId: 'mod-1',
          notFoundMessage: 'Post not found',
        }),
      );
      expect(postsRepository.transitionStatus).toHaveBeenCalledWith({
        id: 'post-1',
        gameId: 'game-1',
        from: 'PUBLISHED',
        to: 'HIDDEN',
      });
      expect(result.status).toBe('HIDDEN');
    });

    it('is idempotent when the post is already hidden', async () => {
      postsRepository.findById.mockResolvedValue({
        ...basePost,
        status: 'HIDDEN',
      });

      const result = await service.hideAsModerator('game-1', 'post-1', 'mod-1');

      expect(postsRepository.transitionStatus).not.toHaveBeenCalled();
      expect(result.status).toBe('HIDDEN');
    });

    it('rejects hiding a draft post', async () => {
      postsRepository.findById.mockResolvedValue({
        ...basePost,
        status: 'DRAFT',
      });

      await expect(
        service.hideAsModerator('game-1', 'post-1', 'mod-1'),
      ).rejects.toThrow(BadRequestException);

      expect(postsRepository.transitionStatus).not.toHaveBeenCalled();
    });

    it('rejects when the post belongs to a different game than the route', async () => {
      postsRepository.findById.mockResolvedValue({
        ...basePost,
        gameId: 'other-game-id',
      });

      await expect(
        service.hideAsModerator('game-1', 'post-1', 'mod-1'),
      ).rejects.toThrow(NotFoundException);

      expect(postsRepository.transitionStatus).not.toHaveBeenCalled();
    });

    it('treats a post that has deletedAt set as not found even if its status has not caught up', async () => {
      postsRepository.findById.mockResolvedValue({
        ...basePost,
        deletedAt: new Date(),
      });

      await expect(
        service.hideAsModerator('game-1', 'post-1', 'mod-1'),
      ).rejects.toThrow(NotFoundException);

      expect(postsRepository.transitionStatus).not.toHaveBeenCalled();
    });

    it('propagates a failed game slug lookup', async () => {
      gameModeratorsService.loadModeratableResource.mockRejectedValue(
        new NotFoundException('Game not found'),
      );

      await expect(
        service.hideAsModerator('missing-game', 'post-1', 'mod-1'),
      ).rejects.toThrow(NotFoundException);

      expect(postsRepository.transitionStatus).not.toHaveBeenCalled();
    });

    it('propagates the moderator permission check failure', async () => {
      gameModeratorsService.loadModeratableResource.mockRejectedValue(
        new ForbiddenException('You cannot moderate this game'),
      );

      await expect(
        service.hideAsModerator('game-1', 'post-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);

      expect(postsRepository.findById).not.toHaveBeenCalled();
      expect(postsRepository.transitionStatus).not.toHaveBeenCalled();
    });

    it('raises a conflict when another request changes the post between the read and the write', async () => {
      postsRepository.findById.mockResolvedValue(basePost);
      postsRepository.transitionStatus.mockResolvedValue(null);

      await expect(
        service.hideAsModerator('game-1', 'post-1', 'mod-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('restoreAsModerator', () => {
    it('restores a hidden post back to published', async () => {
      postsRepository.findById.mockResolvedValue({
        ...basePost,
        status: 'HIDDEN',
      });
      postsRepository.transitionStatus.mockResolvedValue(basePost);

      const result = await service.restoreAsModerator(
        'game-1',
        'post-1',
        'mod-1',
      );

      expect(postsRepository.transitionStatus).toHaveBeenCalledWith({
        id: 'post-1',
        gameId: 'game-1',
        from: 'HIDDEN',
        to: 'PUBLISHED',
      });
      expect(result.status).toBe('PUBLISHED');
    });

    it('is idempotent when the post is already published', async () => {
      postsRepository.findById.mockResolvedValue(basePost);

      const result = await service.restoreAsModerator(
        'game-1',
        'post-1',
        'mod-1',
      );

      expect(postsRepository.transitionStatus).not.toHaveBeenCalled();
      expect(result.status).toBe('PUBLISHED');
    });

    it('rejects restoring a draft post', async () => {
      postsRepository.findById.mockResolvedValue({
        ...basePost,
        status: 'DRAFT',
      });

      await expect(
        service.restoreAsModerator('game-1', 'post-1', 'mod-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when the post is deleted', async () => {
      postsRepository.findById.mockResolvedValue({
        ...basePost,
        status: 'DELETED',
      });

      await expect(
        service.restoreAsModerator('game-1', 'post-1', 'mod-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('raises a conflict when another request changes the post between the read and the write', async () => {
      postsRepository.findById.mockResolvedValue({
        ...basePost,
        status: 'HIDDEN',
      });
      postsRepository.transitionStatus.mockResolvedValue(null);

      await expect(
        service.restoreAsModerator('game-1', 'post-1', 'mod-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('listHiddenForModerator', () => {
    it('resolves and authorizes the routed game, then lists hidden posts for it', async () => {
      const hiddenPost = { ...basePost, status: 'HIDDEN' };
      postsRepository.findHiddenByGame.mockResolvedValue({
        items: [hiddenPost],
        total: 1,
      });

      const result = await service.listHiddenForModerator(
        'wuthering-waves',
        'mod-1',
        {},
      );

      expect(
        gameModeratorsService.resolveModeratableGameId,
      ).toHaveBeenCalledWith('wuthering-waves', 'mod-1');
      expect(postsRepository.findHiddenByGame).toHaveBeenCalledWith('game-1', {
        page: 1,
        limit: 20,
      });
      expect(result.items).toHaveLength(1);
      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
    });

    it('propagates the moderator permission check failure', async () => {
      gameModeratorsService.resolveModeratableGameId.mockRejectedValue(
        new ForbiddenException('You cannot moderate this game'),
      );

      await expect(
        service.listHiddenForModerator('game-1', 'user-1', {}),
      ).rejects.toThrow(ForbiddenException);

      expect(postsRepository.findHiddenByGame).not.toHaveBeenCalled();
    });
  });
});
