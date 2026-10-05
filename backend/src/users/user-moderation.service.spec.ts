import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import type { UsersRepository } from './users.repository';
import type { AuditLogService } from '../audit-log/audit-log.service';
import type { SessionTerminator } from '../auth/session-terminator.service';
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

  const sessionTerminator = { endAllForUser: jest.fn() };

  // Array-of-queries $transaction isn't used here; setStatus uses the
  // interactive callback form, so this just runs the callback against a
  // fake tx (the repository call inside it is mocked, so its identity
  // doesn't matter).
  const prisma = {
    $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
      callback('fake-tx'),
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
      (callback: (tx: unknown) => unknown) => callback('fake-tx'),
    );
    auditLogService.recordOrThrow.mockResolvedValue(undefined);
    sessionTerminator.endAllForUser.mockResolvedValue(undefined);

    service = new UserModerationService(
      usersRepository as unknown as UsersRepository,
      auditLogService as unknown as AuditLogService,
      sessionTerminator as unknown as SessionTerminator,
      prisma as unknown as PrismaService,
    );
  });

  describe('setStatus', () => {
    it('rejects an admin changing their own status', async () => {
      await expect(
        service.setStatus('user-1', 'BANNED', 'user-1'),
      ).rejects.toThrow(ForbiddenException);

      expect(usersRepository.findForModeration).not.toHaveBeenCalled();
    });

    it('rejects when the target does not exist', async () => {
      usersRepository.findForModeration.mockResolvedValue(null);

      await expect(
        service.setStatus('user-1', 'BANNED', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects changing another admin account', async () => {
      usersRepository.findForModeration.mockResolvedValue({
        ...targetUser,
        role: 'ADMIN',
      });

      await expect(
        service.setStatus('user-1', 'BANNED', 'admin-1'),
      ).rejects.toThrow(ForbiddenException);

      expect(usersRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('rejects moderating a deleted account', async () => {
      usersRepository.findForModeration.mockResolvedValue({
        ...targetUser,
        status: 'DELETED',
      });

      await expect(
        service.setStatus('user-1', 'ACTIVE', 'admin-1'),
      ).rejects.toThrow(ConflictException);

      expect(usersRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('rejects a no-op status change', async () => {
      usersRepository.findForModeration.mockResolvedValue({
        ...targetUser,
        status: 'BANNED',
      });

      await expect(
        service.setStatus('user-1', 'BANNED', 'admin-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects when the status changed concurrently', async () => {
      usersRepository.findForModeration.mockResolvedValue(targetUser);
      usersRepository.updateStatus.mockResolvedValue(null);

      await expect(
        service.setStatus('user-1', 'BANNED', 'admin-1'),
      ).rejects.toThrow(ConflictException);

      expect(auditLogService.recordOrThrow).not.toHaveBeenCalled();
      expect(sessionTerminator.endAllForUser).not.toHaveBeenCalled();
    });

    it('bans the user, records the audit entry inside the same transaction, then ends sessions', async () => {
      usersRepository.findForModeration.mockResolvedValue(targetUser);
      usersRepository.updateStatus.mockResolvedValue({
        ...targetUser,
        status: 'BANNED',
      });

      const order: string[] = [];
      auditLogService.recordOrThrow.mockImplementation(() => {
        order.push('audit');
        return Promise.resolve();
      });
      sessionTerminator.endAllForUser.mockImplementation(() => {
        order.push('sessions');
        return Promise.resolve();
      });

      const result = await service.setStatus(
        'user-1',
        'BANNED',
        'admin-1',
        'Repeated abuse',
      );

      expect(usersRepository.updateStatus).toHaveBeenCalledWith(
        'fake-tx',
        'user-1',
        'ACTIVE',
        'BANNED',
      );
      expect(auditLogService.recordOrThrow).toHaveBeenCalledWith(
        {
          action: 'USER_BANNED',
          actorId: 'admin-1',
          targetId: 'user-1',
          targetType: 'USER',
          metadata: { previousStatus: 'ACTIVE', reason: 'Repeated abuse' },
        },
        'fake-tx',
      );
      expect(sessionTerminator.endAllForUser).toHaveBeenCalledWith('user-1');
      // Audit write happens inside the transaction, before the (fallible)
      // session sweep runs outside it - a failed sweep can never cost the trail.
      expect(order).toEqual(['audit', 'sessions']);
      expect(result).toEqual({ ...targetUser, status: 'BANNED' });
    });

    it('rolls back the status change if the audit write fails', async () => {
      usersRepository.findForModeration.mockResolvedValue(targetUser);
      usersRepository.updateStatus.mockResolvedValue({
        ...targetUser,
        status: 'BANNED',
      });
      auditLogService.recordOrThrow.mockRejectedValue(new Error('db down'));

      await expect(
        service.setStatus('user-1', 'BANNED', 'admin-1'),
      ).rejects.toThrow('db down');

      expect(sessionTerminator.endAllForUser).not.toHaveBeenCalled();
    });

    it('reactivating does not end any sessions', async () => {
      usersRepository.findForModeration.mockResolvedValue({
        ...targetUser,
        status: 'BANNED',
      });
      usersRepository.updateStatus.mockResolvedValue({
        ...targetUser,
        status: 'ACTIVE',
      });

      await service.setStatus('user-1', 'ACTIVE', 'admin-1');

      expect(sessionTerminator.endAllForUser).not.toHaveBeenCalled();
      expect(auditLogService.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'USER_REACTIVATED' }),
        'fake-tx',
      );
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
