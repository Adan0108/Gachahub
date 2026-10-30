import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import type { UsersRepository } from './users.repository';
import type { AuditLogService } from '../audit-log/audit-log.service';
import type { PrismaService } from '../prisma/prisma.service';

/*
 * Unit test only mocks service dependencies. Do not load their real
 * implementations because they eventually import Prisma, or (for
 * SessionTerminator) better-auth, which opens a real DB connection at
 * import time.
 */
jest.mock('./users.repository', () => ({
  UsersRepository: class {},
}));

jest.mock('../audit-log/audit-log.service', () => ({
  AuditLogService: class {},
}));

jest.mock('../auth/session-terminator.service', () => ({
  SessionTerminator: class {},
}));

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class {},
}));

import { UserModerationService } from './user-moderation.service';

describe('UserModerationService', () => {
  const usersRepository = {
    findManyForAdmin: jest.fn(),
    findForModeration: jest.fn(),
    updateStatus: jest.fn(),
  };

  const auditLogService = { recordOrThrow: jest.fn() };

  // Array-of-queries $transaction isn't used here; setStatus uses the
  // interactive callback form, so this just runs the callback against a
  // fake tx (the repository call inside it is mocked, so its identity
  // doesn't matter).
  const fakeTx = { moderationCase: { updateMany: jest.fn() } };
  const prisma = {
    $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
      callback(fakeTx),
    ),
  };

  let service: UserModerationService;

  const targetUser = {
    id: 'user-1',
    name: 'Target',
    email: 'target@example.com',
    role: 'USER',
    status: 'ACTIVE',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      (callback: (tx: unknown) => unknown) => callback(fakeTx),
    );
    auditLogService.recordOrThrow.mockResolvedValue(undefined);

    service = new UserModerationService(
      usersRepository as unknown as UsersRepository,
      auditLogService as unknown as AuditLogService,
      prisma as unknown as PrismaService,
    );
  });

  describe('setStatus', () => {
    it.each(['BANNED', 'SUSPENDED', 'DELETED'] as const)(
      'rejects indefinite legacy target %s without writing',
      async (status) => {
        await expect(
          service.setStatus('user-1', status, 'admin-1'),
        ).rejects.toThrow('temporary');
        expect(usersRepository.updateStatus).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );
    it('rejects changing your own account', async () => {
      await expect(
        service.setStatus('admin-1', 'ACTIVE', 'admin-1'),
      ).rejects.toThrow(ForbiddenException);
    });
    it('rejects a missing account', async () => {
      usersRepository.findForModeration.mockResolvedValue(null);
      await expect(
        service.setStatus('user-1', 'ACTIVE', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });
    it('protects another Admin and preserves deleted records', async () => {
      usersRepository.findForModeration.mockResolvedValue({
        ...targetUser,
        role: 'ADMIN',
      });
      await expect(
        service.setStatus('user-1', 'ACTIVE', 'admin-1'),
      ).rejects.toThrow(ForbiddenException);
      usersRepository.findForModeration.mockResolvedValue({
        ...targetUser,
        status: 'DELETED',
      });
      await expect(
        service.setStatus('user-1', 'ACTIVE', 'admin-1'),
      ).rejects.toThrow(ConflictException);
    });
    it('rejects no-op and concurrent status changes', async () => {
      usersRepository.findForModeration.mockResolvedValue(targetUser);
      await expect(
        service.setStatus('user-1', 'ACTIVE', 'admin-1'),
      ).rejects.toThrow(ConflictException);
      usersRepository.findForModeration.mockResolvedValue({
        ...targetUser,
        status: 'SUSPENDED',
      });
      usersRepository.updateStatus.mockResolvedValue(null);
      await expect(
        service.setStatus('user-1', 'ACTIVE', 'admin-1'),
      ).rejects.toThrow('concurrently');
      expect(auditLogService.recordOrThrow).not.toHaveBeenCalled();
    });
    it.each(['BANNED', 'SUSPENDED'])(
      'reactivates preserved %s history with a transactional audit',
      async (status) => {
        usersRepository.findForModeration.mockResolvedValue({
          ...targetUser,
          status,
        });
        usersRepository.updateStatus.mockResolvedValue(targetUser);
        await expect(
          service.setStatus(
            'user-1',
            'ACTIVE',
            'admin-1',
            'Legacy review completed',
          ),
        ).resolves.toEqual(targetUser);
        expect(usersRepository.updateStatus).toHaveBeenCalledWith(
          fakeTx,
          'user-1',
          status,
          'ACTIVE',
        );
        expect(auditLogService.recordOrThrow).toHaveBeenCalledWith(
          {
            action: 'USER_REACTIVATED',
            actorId: 'admin-1',
            targetId: 'user-1',
            targetType: 'USER',
            metadata: {
              previousStatus: status,
              reason: 'Legacy review completed',
            },
          },
          fakeTx,
        );
        expect(fakeTx.moderationCase.updateMany).not.toHaveBeenCalled();
      },
    );
    it('propagates an audit failure so reactivation rolls back', async () => {
      usersRepository.findForModeration.mockResolvedValue({
        ...targetUser,
        status: 'BANNED',
      });
      usersRepository.updateStatus.mockResolvedValue(targetUser);
      auditLogService.recordOrThrow.mockRejectedValue(new Error('db down'));
      await expect(
        service.setStatus('user-1', 'ACTIVE', 'admin-1'),
      ).rejects.toThrow('db down');
    });
  });

  describe('listForAdmin', () => {
    it('paginates through the repository', async () => {
      usersRepository.findManyForAdmin.mockResolvedValue({
        items: [targetUser],
        total: 1,
      });

      const result = await service.listForAdmin({ page: 2, limit: 10 });

      expect(usersRepository.findManyForAdmin).toHaveBeenCalledWith({
        status: undefined,
        role: undefined,
        search: undefined,
        page: 2,
        limit: 10,
      });
      expect(result).toEqual({
        items: [targetUser],
        meta: { page: 2, limit: 10, total: 1, totalPages: 1 },
      });
    });
  });
});
