import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import type { CommentsRepository } from './comments.repository';
import type { GameModeratorsService } from '../game-moderators/game-moderators.service';
import type { AuditLogService } from '../audit-log/audit-log.service';

/*
 * Unit test only mocks service dependencies. Do not load their real
 * implementations because they eventually import Prisma.
 */
jest.mock('./comments.repository', () => ({
  CommentsRepository: class {},
}));

jest.mock('../audit-log/audit-log.service', () => ({
  AuditLogService: class {},
}));

jest.mock('../game-moderators/game-moderators.service', () => ({
  GameModeratorsService: class {},
}));

import { CommentModerationService } from './comment-moderation.service';

describe('CommentModerationService', () => {
  const commentsRepository = {
    findByIdForModeration: jest.fn(),
    transitionStatus: jest.fn(),
    findHiddenByGame: jest.fn(),
  };

  const gameModeratorsService = {
    resolveModeratableGameId: jest.fn(),
  };

  const auditLogService = { record: jest.fn() };

  let service: CommentModerationService;

  const baseComment = {
    id: 'comment-1',
    authorId: 'author-1',
    content: 'Some comment',
    status: 'PUBLISHED',
    deletedAt: null,
    post: { id: 'post-1', gameId: 'game-1' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    gameModeratorsService.resolveModeratableGameId.mockResolvedValue('game-1');

    service = new CommentModerationService(
      commentsRepository as unknown as CommentsRepository,
      gameModeratorsService as unknown as GameModeratorsService,
      auditLogService as unknown as AuditLogService,
    );
  });

  describe('hideAsModerator', () => {
    it('authorizes the routed game, then hides a published comment', async () => {
      commentsRepository.findByIdForModeration.mockResolvedValue(baseComment);
      commentsRepository.transitionStatus.mockResolvedValue({
        ...baseComment,
        status: 'HIDDEN',
      });

      const result = await service.hideAsModerator(
        'wuthering-waves',
        'comment-1',
        'mod-1',
      );

      expect(
        gameModeratorsService.resolveModeratableGameId,
      ).toHaveBeenCalledWith('wuthering-waves', 'mod-1');
      expect(commentsRepository.transitionStatus).toHaveBeenCalledWith({
        id: 'comment-1',
        postId: 'post-1',
        from: 'PUBLISHED',
        to: 'HIDDEN',
      });
      expect(result.status).toBe('HIDDEN');
      expect(auditLogService.record).toHaveBeenCalledWith({
        action: 'COMMENT_HIDDEN',
        actorId: 'mod-1',
        targetType: 'COMMENT',
        targetId: 'comment-1',
        gameId: 'game-1',
        gameSlug: 'wuthering-waves',
        metadata: { authorId: 'author-1', postId: 'post-1' },
      });
    });

    it('is idempotent when the comment is already hidden', async () => {
      commentsRepository.findByIdForModeration.mockResolvedValue({
        ...baseComment,
        status: 'HIDDEN',
      });

      const result = await service.hideAsModerator(
        'game-1',
        'comment-1',
        'mod-1',
      );

      expect(commentsRepository.transitionStatus).not.toHaveBeenCalled();
      expect(auditLogService.record).not.toHaveBeenCalled();
      expect(result.status).toBe('HIDDEN');
      expect(result.postId).toBe('post-1');
    });

    it('rejects when the comment belongs to a different game than the route', async () => {
      commentsRepository.findByIdForModeration.mockResolvedValue({
        ...baseComment,
        post: { id: 'post-1', gameId: 'other-game-id' },
      });

      await expect(
        service.hideAsModerator('game-1', 'comment-1', 'mod-1'),
      ).rejects.toThrow(NotFoundException);

      expect(commentsRepository.transitionStatus).not.toHaveBeenCalled();
    });

    it('treats a comment that has deletedAt set as not found even if its status has not caught up', async () => {
      commentsRepository.findByIdForModeration.mockResolvedValue({
        ...baseComment,
        deletedAt: new Date(),
      });

      await expect(
        service.hideAsModerator('game-1', 'comment-1', 'mod-1'),
      ).rejects.toThrow(NotFoundException);

      expect(commentsRepository.transitionStatus).not.toHaveBeenCalled();
    });

    it('propagates the moderator permission check failure', async () => {
      gameModeratorsService.resolveModeratableGameId.mockRejectedValue(
        new ForbiddenException('You cannot moderate this game'),
      );

      await expect(
        service.hideAsModerator('game-1', 'comment-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);

      expect(commentsRepository.findByIdForModeration).not.toHaveBeenCalled();
      expect(commentsRepository.transitionStatus).not.toHaveBeenCalled();
    });

    it('raises a conflict when another request changes the comment between the read and the write', async () => {
      commentsRepository.findByIdForModeration.mockResolvedValue(baseComment);
      commentsRepository.transitionStatus.mockResolvedValue(null);

      await expect(
        service.hideAsModerator('game-1', 'comment-1', 'mod-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('restoreAsModerator', () => {
    it('restores a hidden comment back to published', async () => {
      commentsRepository.findByIdForModeration.mockResolvedValue({
        ...baseComment,
        status: 'HIDDEN',
      });
      commentsRepository.transitionStatus.mockResolvedValue(baseComment);

      const result = await service.restoreAsModerator(
        'game-1',
        'comment-1',
        'mod-1',
      );

      expect(commentsRepository.transitionStatus).toHaveBeenCalledWith({
        id: 'comment-1',
        postId: 'post-1',
        from: 'HIDDEN',
        to: 'PUBLISHED',
      });
      expect(result.status).toBe('PUBLISHED');
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'COMMENT_RESTORED',
          targetId: 'comment-1',
        }),
      );
    });

    it('is idempotent when the comment is already published', async () => {
      commentsRepository.findByIdForModeration.mockResolvedValue(baseComment);

      const result = await service.restoreAsModerator(
        'game-1',
        'comment-1',
        'mod-1',
      );

      expect(commentsRepository.transitionStatus).not.toHaveBeenCalled();
      expect(result.status).toBe('PUBLISHED');
    });

    it('raises a conflict when another request changes the comment between the read and the write', async () => {
      commentsRepository.findByIdForModeration.mockResolvedValue({
        ...baseComment,
        status: 'HIDDEN',
      });
      commentsRepository.transitionStatus.mockResolvedValue(null);

      await expect(
        service.restoreAsModerator('game-1', 'comment-1', 'mod-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('listHiddenForModerator', () => {
    it('resolves and authorizes the routed game, then lists hidden comments for it', async () => {
      const hiddenComment = { ...baseComment, status: 'HIDDEN' };
      commentsRepository.findHiddenByGame.mockResolvedValue({
        items: [hiddenComment],
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
      expect(commentsRepository.findHiddenByGame).toHaveBeenCalledWith(
        'game-1',
        { page: 1, limit: 20 },
      );
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

      expect(commentsRepository.findHiddenByGame).not.toHaveBeenCalled();
    });

    it('rejects hiding a comment it cannot find (wrong id entirely)', async () => {
      commentsRepository.findByIdForModeration.mockResolvedValue(null);

      await expect(
        service.hideAsModerator('game-1', 'missing-comment', 'mod-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
