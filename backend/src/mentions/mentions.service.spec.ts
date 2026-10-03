import type { Prisma } from '../generated/prisma/client';
import type { EventPublisherPort } from '../domain-events/event-publisher.port';
import type { PrismaService } from '../prisma/prisma.service';
import { MentionsService } from './mentions.service';

jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

describe('MentionsService', () => {
  const eventPublisher = { publishMany: jest.fn() };
  const prisma = { user: { findMany: jest.fn() } };
  const transaction = { mention: { createManyAndReturn: jest.fn() } };
  const service = new MentionsService(
    prisma as unknown as PrismaService,
    eventPublisher as unknown as EventPublisherPort,
  );
  const tx = transaction as unknown as Prisma.TransactionClient;
  const yes = () => Promise.resolve(true);

  beforeEach(() => jest.clearAllMocks());

  describe('resolveTargets', () => {
    it('does nothing when the text has no mentions', async () => {
      await expect(
        service.resolveTargets({ text: 'plain', actorId: 'me', canView: yes }),
      ).resolves.toEqual([]);

      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('only looks up active, non-blocked users other than the author', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await service.resolveTargets({
        text: 'hi @bob',
        actorId: 'me',
        canView: yes,
      });

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          username: { in: ['bob'] },
          id: { not: 'me' },
          status: 'ACTIVE',
          blockedUsers: { none: { blockedId: 'me' } },
          blockedBy: { none: { blockerId: 'me' } },
        },
        select: { id: true },
      });
    });

    it('keeps only the users allowed to view', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);

      await expect(
        service.resolveTargets({
          text: '@bob @amy',
          actorId: 'me',
          canView: (id) => Promise.resolve(id === 'u1'),
        }),
      ).resolves.toEqual(['u1']);
    });
  });

  describe('publishMentions', () => {
    const base = {
      actorId: 'me',
      entityType: 'COMMENT' as const,
      entityId: 'c1',
    };

    it('writes nothing without targets', async () => {
      await service.publishMentions({ ...base, targetIds: [] }, tx);

      expect(transaction.mention.createManyAndReturn).not.toHaveBeenCalled();
      expect(eventPublisher.publishMany).not.toHaveBeenCalled();
    });

    it('emits user.mentioned only for users it newly recorded', async () => {
      transaction.mention.createManyAndReturn.mockResolvedValue([
        { userId: 'u2' },
      ]);

      await service.publishMentions({ ...base, targetIds: ['u1', 'u2'] }, tx);

      expect(transaction.mention.createManyAndReturn).toHaveBeenCalledWith({
        data: [
          { entityType: 'COMMENT', entityId: 'c1', userId: 'u1' },
          { entityType: 'COMMENT', entityId: 'c1', userId: 'u2' },
        ],
        skipDuplicates: true,
        select: { userId: true },
      });
      expect(eventPublisher.publishMany).toHaveBeenCalledWith(
        [
          {
            type: 'user.mentioned',
            aggregateId: 'c1',
            payload: {
              targetUserId: 'u2',
              actorId: 'me',
              entityType: 'COMMENT',
              entityId: 'c1',
            },
          },
        ],
        tx,
      );
    });

    it('emits nothing when every target was already notified', async () => {
      transaction.mention.createManyAndReturn.mockResolvedValue([]);

      await service.publishMentions({ ...base, targetIds: ['u1'] }, tx);

      expect(eventPublisher.publishMany).toHaveBeenCalledWith([], tx);
    });
  });
});
