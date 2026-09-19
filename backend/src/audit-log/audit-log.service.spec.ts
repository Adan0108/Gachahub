import type { DiscordLoggerService } from '../common/discord/discord-logger.service';
import type { AuditLogRepository } from './audit-log.repository';

jest.mock('./audit-log.repository', () => ({
  AuditLogRepository: class {},
}));

jest.mock('../common/discord/discord-logger.service', () => ({
  DiscordLoggerService: class {},
}));

import { AuditLogService } from './audit-log.service';

describe('AuditLogService', () => {
  const auditLogRepository = { create: jest.fn() };
  const discordLogger = { sendError: jest.fn() };

  const entry = {
    action: 'POST_HIDDEN',
    actorId: 'mod-1',
    targetType: 'POST',
    targetId: 'post-1',
    gameId: 'game-1',
    metadata: { authorId: 'author-1', postTitle: 'A post' },
  } as const;

  let service: AuditLogService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuditLogService(
      auditLogRepository as unknown as AuditLogRepository,
      discordLogger as unknown as DiscordLoggerService,
    );
  });

  describe('record', () => {
    it('persists the entry without alerting', async () => {
      auditLogRepository.create.mockResolvedValue({ id: 'log-1' });

      await service.record(entry);

      expect(auditLogRepository.create).toHaveBeenCalledWith(entry);
      expect(discordLogger.sendError).not.toHaveBeenCalled();
    });

    it('swallows a failed write so the moderation action still succeeds', async () => {
      auditLogRepository.create.mockRejectedValue(new Error('db down'));

      await expect(service.record(entry)).resolves.toBeUndefined();
    });

    it('keys the alert per entry so an outage names every lost entry', async () => {
      auditLogRepository.create.mockRejectedValue(new Error('db down'));

      await service.record(entry);

      expect(discordLogger.sendError).toHaveBeenCalledWith(
        expect.objectContaining({
          dedupKey: 'AuditWriteFailed:POST_HIDDEN:POST:post-1',
        }),
      );
    });

    it('alerts Discord when the write fails, naming the lost entry', async () => {
      auditLogRepository.create.mockRejectedValue(new Error('db down'));

      await service.record(entry);

      expect(discordLogger.sendError).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'audit',
          title: 'Audit entry lost: POST_HIDDEN',
        }),
      );
    });
  });

  describe('recordOrThrow', () => {
    const tx = {} as never;

    it('writes through the caller transaction', async () => {
      auditLogRepository.create.mockResolvedValue({ id: 'log-1' });

      await service.recordOrThrow(entry, tx);

      expect(auditLogRepository.create).toHaveBeenCalledWith(entry, tx);
    });

    it('rethrows so the transaction rolls back, and alerts that the change was rolled back', async () => {
      auditLogRepository.create.mockRejectedValue(new Error('db down'));

      await expect(service.recordOrThrow(entry, tx)).rejects.toThrow('db down');
      expect(discordLogger.sendError).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'audit',
          title: 'Change rolled back, audit write failed: POST_HIDDEN',
        }),
      );
    });
  });
});
