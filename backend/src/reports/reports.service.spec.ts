import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import type { ReportsRepository } from './reports.repository';
import type { FollowsService } from '../follows/follows.service';
import { PostVisibilityService } from '../post-visibility/post-visibility.service';
import type { ReportRateLimiterService } from './report-rate-limiter.service';
import type { PrismaService } from '../prisma/prisma.service';

/*
 * Unit test only mocks service dependencies. Do not load their real
 * implementations because they eventually import Prisma. loadActiveUser is
 * NOT mocked - its real logic runs against the mocked `prisma` object below,
 * same as GameModeratorsService's own spec.
 */
jest.mock('./reports.repository', () => ({
  ReportsRepository: class {},
}));

jest.mock('../follows/follows.service', () => ({
  FollowsService: class {},
}));

jest.mock('./report-rate-limiter.service', () => ({
  ReportRateLimiterService: class {},
}));

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class {},
}));

import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  const reportsRepository = {
    findTargetPostInfo: jest.fn(),
    hasOpenReport: jest.fn(),
    create: jest.fn(),
  };

  const followsService = {
    isFollowing: jest.fn(),
  };

  const reportRateLimiter = {
    assertNotRateLimited: jest.fn(),
  };

  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
  };

  let service: ReportsService;

  const activeReporter = { id: 'reporter-1', role: 'USER', status: 'ACTIVE' };

  const publicPost = {
    gameId: 'game-1',
    deletedAt: null,
    status: 'PUBLISHED',
    visibility: 'PUBLIC',
    authorId: 'author-1',
  };

  const baseReport = {
    id: 'report-1',
    gameId: 'game-1',
    reporterId: 'reporter-1',
    targetType: 'POST',
    targetId: 'post-1',
    reasonCode: 'HARASSMENT',
    status: 'PENDING',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue(activeReporter);
    // clearAllMocks() resets call history but not a mockImplementation set by
    // an earlier test, so the rate-limiter needs an explicit default here too.
    reportRateLimiter.assertNotRateLimited.mockImplementation(() => undefined);

    service = new ReportsService(
      reportsRepository as unknown as ReportsRepository,
      new PostVisibilityService(followsService as unknown as FollowsService),
      reportRateLimiter as unknown as ReportRateLimiterService,
      prisma as unknown as PrismaService,
    );
  });

  describe('create', () => {
    it('files a report and denormalizes the target game onto it', async () => {
      reportsRepository.findTargetPostInfo.mockResolvedValue(publicPost);
      reportsRepository.hasOpenReport.mockResolvedValue(false);
      reportsRepository.create.mockResolvedValue(baseReport);

      const result = await service.create('reporter-1', {
        targetType: 'POST',
        targetId: 'post-1',
        reasonCode: 'HARASSMENT',
      });

      expect(reportRateLimiter.assertNotRateLimited).toHaveBeenCalledWith(
        'reporter-1',
      );
      expect(reportsRepository.create).toHaveBeenCalledWith({
        gameId: 'game-1',
        reporterId: 'reporter-1',
        targetType: 'POST',
        targetId: 'post-1',
        reasonCode: 'HARASSMENT',
        details: undefined,
      });
      expect(result).toBe(baseReport);
    });

    it('trims details and drops a whitespace-only value', async () => {
      reportsRepository.findTargetPostInfo.mockResolvedValue(publicPost);
      reportsRepository.hasOpenReport.mockResolvedValue(false);
      reportsRepository.create.mockResolvedValue(baseReport);

      await service.create('reporter-1', {
        targetType: 'POST',
        targetId: 'post-1',
        reasonCode: 'HARASSMENT',
        details: '   ',
      });

      expect(reportsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ details: undefined }),
      );

      await service.create('reporter-1', {
        targetType: 'POST',
        targetId: 'post-1',
        reasonCode: 'HARASSMENT',
        details: '  spam link  ',
      });

      expect(reportsRepository.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ details: 'spam link' }),
      );
    });

    it('rejects when the reporter account is not active', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeReporter,
        status: 'BANNED',
      });

      await expect(
        service.create('reporter-1', {
          targetType: 'POST',
          targetId: 'post-1',
          reasonCode: 'HARASSMENT',
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(reportsRepository.findTargetPostInfo).not.toHaveBeenCalled();
    });

    it('rejects when the reporter account no longer exists', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.create('reporter-1', {
          targetType: 'POST',
          targetId: 'post-1',
          reasonCode: 'HARASSMENT',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('propagates the rate limiter before touching anything else', async () => {
      reportRateLimiter.assertNotRateLimited.mockImplementation(() => {
        throw new Error('rate limited');
      });

      await expect(
        service.create('reporter-1', {
          targetType: 'POST',
          targetId: 'post-1',
          reasonCode: 'HARASSMENT',
        }),
      ).rejects.toThrow('rate limited');

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('rejects reporting content that does not exist', async () => {
      reportsRepository.findTargetPostInfo.mockResolvedValue(null);

      await expect(
        service.create('reporter-1', {
          targetType: 'POST',
          targetId: 'missing',
          reasonCode: 'HARASSMENT',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(reportsRepository.create).not.toHaveBeenCalled();
    });

    it('rejects a draft post', async () => {
      reportsRepository.findTargetPostInfo.mockResolvedValue({
        ...publicPost,
        status: 'DRAFT',
      });

      await expect(
        service.create('reporter-1', {
          targetType: 'POST',
          targetId: 'post-1',
          reasonCode: 'HARASSMENT',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a private post outright, even for its own author', async () => {
      reportsRepository.findTargetPostInfo.mockResolvedValue({
        ...publicPost,
        visibility: 'PRIVATE',
        authorId: 'reporter-1',
      });

      await expect(
        service.create('reporter-1', {
          targetType: 'POST',
          targetId: 'post-1',
          reasonCode: 'HARASSMENT',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a followers-only post from a non-follower', async () => {
      reportsRepository.findTargetPostInfo.mockResolvedValue({
        ...publicPost,
        visibility: 'FOLLOWERS_ONLY',
      });
      followsService.isFollowing.mockResolvedValue({ following: false });

      await expect(
        service.create('reporter-1', {
          targetType: 'POST',
          targetId: 'post-1',
          reasonCode: 'HARASSMENT',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('allows a followers-only post for a follower of the author', async () => {
      reportsRepository.findTargetPostInfo.mockResolvedValue({
        ...publicPost,
        visibility: 'FOLLOWERS_ONLY',
      });
      followsService.isFollowing.mockResolvedValue({ following: true });
      reportsRepository.hasOpenReport.mockResolvedValue(false);
      reportsRepository.create.mockResolvedValue(baseReport);

      await expect(
        service.create('reporter-1', {
          targetType: 'POST',
          targetId: 'post-1',
          reasonCode: 'HARASSMENT',
        }),
      ).resolves.toBe(baseReport);
    });

    it('allows a followers-only post for its own author without a follow check', async () => {
      reportsRepository.findTargetPostInfo.mockResolvedValue({
        ...publicPost,
        visibility: 'FOLLOWERS_ONLY',
        authorId: 'reporter-1',
      });
      reportsRepository.hasOpenReport.mockResolvedValue(false);
      reportsRepository.create.mockResolvedValue(baseReport);

      await expect(
        service.create('reporter-1', {
          targetType: 'POST',
          targetId: 'post-1',
          reasonCode: 'HARASSMENT',
        }),
      ).resolves.toBe(baseReport);
      expect(followsService.isFollowing).not.toHaveBeenCalled();
    });

    it('rejects a second open report on the same target', async () => {
      reportsRepository.findTargetPostInfo.mockResolvedValue(publicPost);
      reportsRepository.hasOpenReport.mockResolvedValue(true);

      await expect(
        service.create('reporter-1', {
          targetType: 'POST',
          targetId: 'post-1',
          reasonCode: 'HARASSMENT',
        }),
      ).rejects.toThrow(ConflictException);

      expect(reportsRepository.create).not.toHaveBeenCalled();
    });

    it('propagates a duplicate-open-report conflict from the repository (the race the pre-check can miss)', async () => {
      reportsRepository.findTargetPostInfo.mockResolvedValue(publicPost);
      reportsRepository.hasOpenReport.mockResolvedValue(false);
      reportsRepository.create.mockRejectedValue(
        new ConflictException(
          'You already have an open report on this content',
        ),
      );

      await expect(
        service.create('reporter-1', {
          targetType: 'POST',
          targetId: 'post-1',
          reasonCode: 'HARASSMENT',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
