import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import type { GameModeratorsService } from '../game-moderators/game-moderators.service';
import type { MediaService } from '../media/media.service';
import type { AuditLogService } from '../audit-log/audit-log.service';
import type { PrismaService } from '../prisma/prisma.service';

/*
 * Unit test only mocks service dependencies. Do not load their real
 * implementations because they eventually import Prisma.
 */
jest.mock('./games.repository', () => ({
  GamesRepository: class {},
  BrandingConflictError: class extends Error {},
}));
jest.mock('../game-moderators/game-moderators.service', () => ({
  GameModeratorsService: class {},
}));
jest.mock('../media/media.service', () => ({
  MediaService: class {},
}));
jest.mock('../audit-log/audit-log.service', () => ({
  AuditLogService: class {},
}));
jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class {},
}));

import {
  BrandingConflictError,
  type GamesRepository,
} from './games.repository';
import { GameModerationService } from './game-moderation.service';

describe('GameModerationService', () => {
  const gamesRepository = {
    claimAndUpdateBranding: jest.fn(),
    tryTransitionStatus: jest.fn(),
  };
  const gameModeratorsService = {
    resolveModeratableGame: jest.fn(),
  };
  const mediaService = {
    resolveSingleImage: jest.fn(),
    releaseReplacedUpload: jest.fn(),
  };
  const auditLogService = { record: jest.fn(), recordOrThrow: jest.fn() };

  // user.findUnique backs assertIsAdmin's own loadActiveUser call (archive/restore) - same mocking
  // pattern as game-moderators.service.spec.ts, defaulted to an admin so existing tests don't all
  // need to set it explicitly.
  const prisma = {
    user: { findUnique: jest.fn() },
    $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
      callback('fake-tx'),
    ),
  };

  let service: GameModerationService;

  const baseGame = {
    id: 'game-1',
    slug: 'wuthering-waves',
    status: 'ACTIVE',
    iconMediaUploadId: null,
    bannerMediaUploadId: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    gameModeratorsService.resolveModeratableGame.mockResolvedValue({
      id: 'game-1',
      status: 'ACTIVE',
    });
    prisma.user.findUnique.mockResolvedValue({
      id: 'admin-1',
      role: 'ADMIN',
      status: 'ACTIVE',
    });
    prisma.$transaction.mockImplementation(
      (callback: (tx: unknown) => unknown) => callback('fake-tx'),
    );
    auditLogService.record.mockResolvedValue(undefined);
    auditLogService.recordOrThrow.mockResolvedValue(undefined);
    mediaService.releaseReplacedUpload.mockResolvedValue(undefined);

    service = new GameModerationService(
      gamesRepository as unknown as GamesRepository,
      gameModeratorsService as unknown as GameModeratorsService,
      mediaService as unknown as MediaService,
      auditLogService as unknown as AuditLogService,
      prisma as unknown as PrismaService,
    );
  });

  describe('updateBranding', () => {
    it('rejects a request with neither field set', async () => {
      await expect(
        service.updateBranding('wuthering-waves', 'mod-1', {}),
      ).rejects.toThrow(BadRequestException);

      expect(
        gameModeratorsService.resolveModeratableGame,
      ).not.toHaveBeenCalled();
    });

    it('claims and writes a new icon, with no old upload to release', async () => {
      mediaService.resolveSingleImage.mockResolvedValue({
        id: 'upload-1',
        secureUrl: 'https://res.cloudinary.com/icon.png',
      });
      gamesRepository.claimAndUpdateBranding.mockResolvedValue({
        game: {
          ...baseGame,
          iconUrl: 'https://res.cloudinary.com/icon.png',
          iconMediaUploadId: 'upload-1',
        },
        previousUploadIds: {},
      });

      const result = await service.updateBranding('wuthering-waves', 'mod-1', {
        iconMediaUploadId: 'upload-1',
      });

      expect(gameModeratorsService.resolveModeratableGame).toHaveBeenCalledWith(
        'wuthering-waves',
        'mod-1',
      );
      expect(mediaService.resolveSingleImage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'upload-1',
          userId: 'mod-1',
          purpose: 'GAME_ICON',
        }),
      );
      expect(gamesRepository.claimAndUpdateBranding).toHaveBeenCalledWith({
        gameId: 'game-1',
        actorId: 'mod-1',
        slots: {
          icon: {
            id: 'upload-1',
            secureUrl: 'https://res.cloudinary.com/icon.png',
          },
        },
      });
      expect(mediaService.releaseReplacedUpload).not.toHaveBeenCalled();
      expect(result.iconUrl).toBe('https://res.cloudinary.com/icon.png');
      expect(result).not.toHaveProperty('iconMediaUploadId');
    });

    it('claims both icon and banner in one call', async () => {
      mediaService.resolveSingleImage

        .mockResolvedValueOnce({
          id: 'upload-icon',
          secureUrl: 'https://res.cloudinary.com/i.png',
        })

        .mockResolvedValueOnce({
          id: 'upload-banner',
          secureUrl: 'https://res.cloudinary.com/b.png',
        });
      gamesRepository.claimAndUpdateBranding.mockResolvedValue({
        game: baseGame,
        previousUploadIds: {},
      });

      await service.updateBranding('wuthering-waves', 'mod-1', {
        iconMediaUploadId: 'upload-icon',
        bannerMediaUploadId: 'upload-banner',
      });

      expect(mediaService.resolveSingleImage).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'GAME_BANNER' }),
      );
      expect(gamesRepository.claimAndUpdateBranding).toHaveBeenCalledWith({
        gameId: 'game-1',
        actorId: 'mod-1',
        slots: {
          icon: {
            id: 'upload-icon',
            secureUrl: 'https://res.cloudinary.com/i.png',
          },
          banner: {
            id: 'upload-banner',
            secureUrl: 'https://res.cloudinary.com/b.png',
          },
        },
      });
    });

    it('releases the old icon upload after a successful replace', async () => {
      mediaService.resolveSingleImage.mockResolvedValue({
        id: 'upload-new',
        secureUrl: 'https://res.cloudinary.com/new.png',
      });
      gamesRepository.claimAndUpdateBranding.mockResolvedValue({
        game: baseGame,
        previousUploadIds: { icon: 'old-upload' },
      });

      await service.updateBranding('wuthering-waves', 'mod-1', {
        iconMediaUploadId: 'upload-new',
      });

      expect(mediaService.releaseReplacedUpload).toHaveBeenCalledWith(
        'old-upload',
      );
    });

    it('propagates a moderator permission failure without touching media', async () => {
      gameModeratorsService.resolveModeratableGame.mockRejectedValue(
        new ForbiddenException('You cannot moderate this game'),
      );

      await expect(
        service.updateBranding('other-game', 'user-1', {
          iconMediaUploadId: 'upload-1',
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(mediaService.resolveSingleImage).not.toHaveBeenCalled();
    });

    it('propagates a conflict when another replace wins the race', async () => {
      mediaService.resolveSingleImage.mockResolvedValue({
        id: 'upload-new',
        secureUrl: 'https://res.cloudinary.com/new.png',
      });
      gamesRepository.claimAndUpdateBranding.mockRejectedValue(
        new BrandingConflictError(),
      );

      await expect(
        service.updateBranding('wuthering-waves', 'mod-1', {
          iconMediaUploadId: 'upload-new',
        }),
      ).rejects.toThrow(ConflictException);

      expect(mediaService.releaseReplacedUpload).not.toHaveBeenCalled();
    });

    it('rejects branding replace on an archived game', async () => {
      gameModeratorsService.resolveModeratableGame.mockResolvedValue({
        id: 'game-1',
        status: 'ARCHIVED',
      });

      await expect(
        service.updateBranding('wuthering-waves', 'mod-1', {
          iconMediaUploadId: 'upload-1',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(mediaService.resolveSingleImage).not.toHaveBeenCalled();
    });
  });

  describe('archive', () => {
    it('archives an active game and records the audit entry atomically', async () => {
      gamesRepository.tryTransitionStatus.mockResolvedValue({
        kind: 'success',
        game: { ...baseGame, status: 'ARCHIVED' },
      });

      const result = await service.archive('wuthering-waves', 'admin-1');

      expect(gamesRepository.tryTransitionStatus).toHaveBeenCalledWith(
        'fake-tx',
        { slug: 'wuthering-waves', from: 'ACTIVE', to: 'ARCHIVED' },
      );
      expect(auditLogService.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'GAME_ARCHIVED',
          actorId: 'admin-1',
          targetType: 'GAME',
          targetId: 'game-1',
        }),
        'fake-tx',
      );
      expect(result.status).toBe('ARCHIVED');
    });

    it('rejects a non-admin caller before touching the game', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        role: 'USER',
        status: 'ACTIVE',
      });

      await expect(
        service.archive('wuthering-waves', 'user-1'),
      ).rejects.toThrow(ForbiddenException);

      expect(gamesRepository.tryTransitionStatus).not.toHaveBeenCalled();
    });

    it('is idempotent when the game is already archived', async () => {
      gamesRepository.tryTransitionStatus.mockResolvedValue({
        kind: 'idempotent',
        game: { ...baseGame, status: 'ARCHIVED' },
      });

      const result = await service.archive('wuthering-waves', 'admin-1');

      expect(auditLogService.recordOrThrow).not.toHaveBeenCalled();
      expect(result.status).toBe('ARCHIVED');
    });

    it('rejects archiving a game that is neither active nor already archived', async () => {
      gamesRepository.tryTransitionStatus.mockResolvedValue({
        kind: 'invalid_state',
        game: { ...baseGame, status: 'HIDDEN' },
      });

      await expect(
        service.archive('wuthering-waves', 'admin-1'),
      ).rejects.toThrow(BadRequestException);

      expect(auditLogService.recordOrThrow).not.toHaveBeenCalled();
    });

    it('404s when the game does not exist', async () => {
      gamesRepository.tryTransitionStatus.mockResolvedValue({
        kind: 'not_found',
      });

      await expect(service.archive('missing-game', 'admin-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('restore', () => {
    it('restores an archived game and records the audit entry', async () => {
      gamesRepository.tryTransitionStatus.mockResolvedValue({
        kind: 'success',
        game: baseGame,
      });

      const result = await service.restore('wuthering-waves', 'admin-1');

      expect(gamesRepository.tryTransitionStatus).toHaveBeenCalledWith(
        'fake-tx',
        { slug: 'wuthering-waves', from: 'ARCHIVED', to: 'ACTIVE' },
      );
      expect(auditLogService.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'GAME_RESTORED' }),
        'fake-tx',
      );
      expect(result.status).toBe('ACTIVE');
    });
  });

  describe('flagForReview', () => {
    it('authorizes via the moderator-inclusive check and writes a fire-and-forget audit entry', async () => {
      const result = await service.flagForReview('wuthering-waves', 'mod-1', {
        reason: 'Banner looks outdated',
      });

      expect(gameModeratorsService.resolveModeratableGame).toHaveBeenCalledWith(
        'wuthering-waves',
        'mod-1',
      );
      expect(auditLogService.record).toHaveBeenCalledWith({
        action: 'GAME_FLAGGED',
        actorId: 'mod-1',
        targetType: 'GAME',
        targetId: 'game-1',
        gameId: 'game-1',
        gameSlug: 'wuthering-waves',
        metadata: { reason: 'Banner looks outdated' },
      });
      expect(result).toEqual({ message: 'Flagged for admin review' });
    });

    it('omits metadata entirely when no reason is given', async () => {
      await service.flagForReview('wuthering-waves', 'mod-1', {});

      const [entry] = auditLogService.record.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect('metadata' in entry).toBe(false);
    });

    it('rejects a non-moderator before writing anything', async () => {
      gameModeratorsService.resolveModeratableGame.mockRejectedValue(
        new ForbiddenException('You cannot moderate this game'),
      );

      await expect(
        service.flagForReview('wuthering-waves', 'user-1', {}),
      ).rejects.toThrow(ForbiddenException);

      expect(auditLogService.record).not.toHaveBeenCalled();
    });

    it('rejects flagging an archived game', async () => {
      gameModeratorsService.resolveModeratableGame.mockResolvedValue({
        id: 'game-1',
        status: 'ARCHIVED',
      });

      await expect(
        service.flagForReview('wuthering-waves', 'mod-1', {}),
      ).rejects.toThrow(NotFoundException);

      expect(auditLogService.record).not.toHaveBeenCalled();
    });
  });
});
