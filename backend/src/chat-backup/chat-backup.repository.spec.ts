import type { PrismaService } from '../prisma/prisma.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class {},
}));

import { ForbiddenException } from '@nestjs/common';
import { ChatBackupRepository } from './chat-backup.repository';
import { computeBackupProof } from './replace-proof';

describe('ChatBackupRepository', () => {
  const prisma = {
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
    chatBackupBlob: {
      deleteMany: jest.fn(),
      aggregate: jest.fn(),
      findMany: jest.fn(),
      createMany: jest.fn(),
    },
    chatBackupKey: {
      createMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    chatMessage: { findMany: jest.fn() },
    chatParticipant: { findMany: jest.fn() },
  };
  let repository: ChatBackupRepository;

  beforeEach(() => {
    jest.resetAllMocks();
    repository = new ChatBackupRepository(prisma as unknown as PrismaService);
    prisma.$transaction.mockImplementation((run: (tx: unknown) => unknown) =>
      run(prisma),
    );
  });

  describe('verifyProofAndMutate', () => {
    const SECRET = Buffer.alloc(32, 9);
    const NONCE = Buffer.alloc(32, 3).toString('base64');
    const validProof = (secret = SECRET) =>
      computeBackupProof(secret, 'delete', {
        userId: 'u1',
        nonce: NONCE,
      }).toString('base64');

    beforeEach(() => {
      prisma.chatBackupKey.findUnique.mockResolvedValue({
        replaceSecret: SECRET,
      });
      prisma.chatBackupKey.updateMany.mockResolvedValue({ count: 1 });
    });

    it('locks, re-reads the secret, consumes the challenge, then mutates - in that order', async () => {
      const order: string[] = [];
      prisma.$executeRaw.mockImplementation(() => order.push('lock'));
      prisma.chatBackupKey.findUnique.mockImplementation(() => {
        order.push('read-secret');
        return { replaceSecret: SECRET };
      });
      prisma.chatBackupKey.updateMany.mockImplementation(() => {
        order.push('consume-challenge');
        return { count: 1 };
      });
      const mutate = jest.fn(async () => {
        order.push('mutate');
      });

      await repository.verifyProofAndMutate(
        'u1',
        { action: 'delete', nonce: NONCE, proof: validProof(), now: new Date() },
        mutate,
      );

      expect(order).toEqual(['lock', 'read-secret', 'consume-challenge', 'mutate']);
      expect(mutate).toHaveBeenCalledWith(prisma, SECRET);
    });

    it('refuses when there is no stored secret, without consuming the challenge', async () => {
      prisma.chatBackupKey.findUnique.mockResolvedValue(null);
      const mutate = jest.fn();

      await expect(
        repository.verifyProofAndMutate(
          'u1',
          { action: 'delete', nonce: NONCE, proof: validProof(), now: new Date() },
          mutate,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.chatBackupKey.updateMany).not.toHaveBeenCalled();
      expect(mutate).not.toHaveBeenCalled();
    });

    it('refuses a replayed, expired or unknown nonce, without mutating', async () => {
      prisma.chatBackupKey.updateMany.mockResolvedValue({ count: 0 });
      const mutate = jest.fn();

      await expect(
        repository.verifyProofAndMutate(
          'u1',
          { action: 'delete', nonce: NONCE, proof: validProof(), now: new Date() },
          mutate,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mutate).not.toHaveBeenCalled();
    });

    it('refuses a proof that does not match the freshly-read secret, without mutating', async () => {
      const mutate = jest.fn();

      await expect(
        repository.verifyProofAndMutate(
          'u1',
          {
            action: 'delete',
            nonce: NONCE,
            proof: validProof(Buffer.alloc(32, 1)),
            now: new Date(),
          },
          mutate,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mutate).not.toHaveBeenCalled();
    });

    it('two interleaved requests: the second sees the first mutation, under the same lock', async () => {
      // A fake lock queue, like storeWithinQuota's concurrency test below:
      // each transaction runs to completion before the next starts.
      let secret = SECRET;
      let chain: Promise<unknown> = Promise.resolve();
      prisma.$transaction.mockImplementation(
        (run: (tx: unknown) => unknown) => {
          const result = chain.then(() => run(prisma));
          chain = result.catch(() => undefined);
          return result;
        },
      );
      prisma.chatBackupKey.findUnique.mockImplementation(() => ({
        replaceSecret: secret,
      }));
      prisma.chatBackupKey.updateMany.mockResolvedValue({ count: 1 });

      const replacement = Buffer.alloc(32, 5);
      const results = await Promise.allSettled([
        repository.verifyProofAndMutate(
          'u1',
          { action: 'delete', nonce: NONCE, proof: validProof(SECRET), now: new Date() },
          async () => {
            secret = replacement;
          },
        ),
        repository.verifyProofAndMutate(
          'u1',
          { action: 'delete', nonce: NONCE, proof: validProof(SECRET), now: new Date() },
          async () => {
            secret = replacement;
          },
        ),
      ]);

      // Whichever ran second re-read the secret the first one's mutate already
      // changed, so its proof (computed for the original secret) no longer
      // matches - it cannot silently act using proof for a stale key.
      const outcomes = results.map((r) => r.status);
      expect(outcomes.filter((s) => s === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((s) => s === 'rejected')).toHaveLength(1);
    });
  });

  it('deleteAll removes blobs and key under the user lock', async () => {
    const order: string[] = [];
    prisma.$executeRaw.mockImplementation(() => order.push('lock'));
    prisma.chatBackupBlob.deleteMany.mockImplementation(() =>
      order.push('blobs'),
    );
    prisma.chatBackupKey.deleteMany.mockImplementation(() => order.push('key'));

    await repository.deleteAll('u1');

    expect(order).toEqual(['lock', 'blobs', 'key']);
  });

  it('deleteAll with dueBefore deletes nothing when the schedule is gone', async () => {
    prisma.chatBackupKey.count.mockResolvedValue(0);
    const now = new Date();

    await expect(repository.deleteAll('u1', now)).resolves.toBe(false);

    expect(prisma.chatBackupKey.count).toHaveBeenCalledWith({
      where: { userId: 'u1', deletionScheduledAt: { lte: now } },
    });
    expect(prisma.chatBackupBlob.deleteMany).not.toHaveBeenCalled();
    expect(prisma.chatBackupKey.deleteMany).not.toHaveBeenCalled();
  });

  it('deleteAll with dueBefore deletes when the schedule is still due', async () => {
    prisma.chatBackupKey.count.mockResolvedValue(1);

    await expect(repository.deleteAll('u1', new Date())).resolves.toBe(true);

    expect(prisma.chatBackupBlob.deleteMany).toHaveBeenCalled();
    expect(prisma.chatBackupKey.deleteMany).toHaveBeenCalled();
  });

  it('scheduleDeletion only sets an empty schedule', async () => {
    const at = new Date();

    await repository.scheduleDeletion('u1', at);

    expect(prisma.chatBackupKey.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', deletionScheduledAt: null },
      data: { deletionScheduledAt: at },
    });
  });

  it('cancelDeletion clears the schedule', async () => {
    await repository.cancelDeletion('u1');

    expect(prisma.chatBackupKey.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      data: { deletionScheduledAt: null },
    });
  });

  it('findDueDeletions returns only users whose schedule has passed', async () => {
    prisma.chatBackupKey.findMany.mockResolvedValue([{ userId: 'a' }]);
    const now = new Date();

    await expect(repository.findDueDeletions(now, 10)).resolves.toEqual(['a']);

    expect(prisma.chatBackupKey.findMany).toHaveBeenCalledWith({
      where: { deletionScheduledAt: { lte: now } },
      select: { userId: true },
      take: 10,
    });
  });

  it('createKey is false when the key row already exists', async () => {
    prisma.chatBackupKey.createMany.mockResolvedValue({ count: 0 });

    await expect(
      repository.createKey('u1', new Uint8Array([1]), new Uint8Array([2])),
    ).resolves.toBe(false);
    expect(prisma.chatBackupKey.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  it('consumeChallenge only matches a live nonce and reports whether it did', async () => {
    const now = new Date(10);
    prisma.chatBackupKey.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.chatBackupKey.updateMany.mockResolvedValueOnce({ count: 0 });

    const nonce = new Uint8Array([7]);
    await expect(repository.consumeChallenge('u1', nonce, now)).resolves.toBe(
      true,
    );
    await expect(repository.consumeChallenge('u1', nonce, now)).resolves.toBe(
      false,
    );
    expect(prisma.chatBackupKey.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        challengeNonce: nonce,
        challengeExpiresAt: { gt: now },
      },
      data: { challengeNonce: null, challengeExpiresAt: null },
    });
  });

  it('usage sums sizes and treats no rows as zero bytes', async () => {
    prisma.chatBackupBlob.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { size: null },
    });

    await expect(repository.usage('u1')).resolves.toEqual({
      blobCount: 0,
      bytesUsed: 0,
    });
  });

  it('findMessagesInConversations drops ids whose conversation differs', async () => {
    prisma.chatMessage.findMany.mockResolvedValue([
      { id: 'm1', conversationId: 'c1' },
      { id: 'm2', conversationId: 'other' },
    ]);

    const ok = await repository.findMessagesInConversations([
      { messageId: 'm1', conversationId: 'c1' },
      { messageId: 'm2', conversationId: 'c1' },
      { messageId: 'm3', conversationId: 'c1' },
    ]);

    expect([...ok]).toEqual(['m1']);
  });

  describe('storeWithinQuota', () => {
    const blob = (messageId: string, size: number) => ({
      conversationId: 'c1',
      messageId,
      ciphertext: new Uint8Array(size),
      size,
    });

    beforeEach(() => {
      prisma.chatBackupKey.findUnique.mockResolvedValue({ userId: 'u1' });
      prisma.chatBackupBlob.findMany.mockResolvedValue([]);
      prisma.chatBackupBlob.aggregate.mockResolvedValue({ _sum: { size: 0 } });
      prisma.chatBackupBlob.createMany.mockImplementation(
        ({ data }: { data: unknown[] }) => ({ count: data.length }),
      );
    });

    it('takes the user lock before reading usage or inserting', async () => {
      const order: string[] = [];
      prisma.$executeRaw.mockImplementation(() => order.push('lock'));
      prisma.chatBackupBlob.aggregate.mockImplementation(() => {
        order.push('sum');
        return { _sum: { size: 0 } };
      });
      prisma.chatBackupBlob.createMany.mockImplementation(() => {
        order.push('insert');
        return { count: 1 };
      });

      await repository.storeWithinQuota('u1', [blob('m1', 5)], 100);

      expect(order).toEqual(['lock', 'sum', 'insert']);
    });

    it('inserts only the new blobs, with skipDuplicates', async () => {
      prisma.chatBackupBlob.findMany.mockResolvedValue([{ messageId: 'm1' }]);

      await expect(
        repository.storeWithinQuota('u1', [blob('m1', 5), blob('m2', 5)], 100),
      ).resolves.toEqual({ status: 'stored', stored: 1 });
      expect(prisma.chatBackupBlob.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({ messageId: 'm2', userId: 'u1' })],
          skipDuplicates: true,
        }),
      );
    });

    it('writes nothing when every blob already exists', async () => {
      prisma.chatBackupBlob.findMany.mockResolvedValue([{ messageId: 'm1' }]);

      await expect(
        repository.storeWithinQuota('u1', [blob('m1', 5)], 100),
      ).resolves.toEqual({ status: 'stored', stored: 0 });
      expect(prisma.chatBackupBlob.createMany).not.toHaveBeenCalled();
    });

    it('refuses an insert that would pass the quota and allows one landing on it', async () => {
      prisma.chatBackupBlob.aggregate.mockResolvedValue({ _sum: { size: 90 } });

      await expect(
        repository.storeWithinQuota('u1', [blob('m1', 11)], 100),
      ).resolves.toEqual({ status: 'over-quota' });
      expect(prisma.chatBackupBlob.createMany).not.toHaveBeenCalled();
      await expect(
        repository.storeWithinQuota('u1', [blob('m1', 10)], 100),
      ).resolves.toEqual({ status: 'stored', stored: 1 });
    });

    it('reports no-key when backup was turned off, without inserting', async () => {
      prisma.chatBackupKey.findUnique.mockResolvedValue(null);

      await expect(
        repository.storeWithinQuota('u1', [blob('m1', 5)], 100),
      ).resolves.toEqual({ status: 'no-key' });
      expect(prisma.chatBackupBlob.createMany).not.toHaveBeenCalled();
    });

    it('serialises concurrent uploads: the second sees the first insert', async () => {
      // A fake lock queue: each transaction runs to completion before the next starts.
      let stored = 0;
      let chain: Promise<unknown> = Promise.resolve();
      prisma.$transaction.mockImplementation(
        (run: (tx: unknown) => unknown) => {
          const result = chain.then(() => run(prisma));
          chain = result.catch(() => undefined);
          return result;
        },
      );
      prisma.chatBackupBlob.aggregate.mockImplementation(() => ({
        _sum: { size: stored },
      }));
      prisma.chatBackupBlob.createMany.mockImplementation(
        ({ data }: { data: { size: number }[] }) => {
          stored += data.reduce((sum, row) => sum + row.size, 0);
          return { count: data.length };
        },
      );

      const results = await Promise.all([
        repository.storeWithinQuota('u1', [blob('a', 60)], 100),
        repository.storeWithinQuota('u1', [blob('b', 60)], 100),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([
        'over-quota',
        'stored',
      ]);
    });
  });

  describe('findParticipatedConversations', () => {
    it('only counts states that could have decrypted messages', async () => {
      prisma.chatParticipant.findMany.mockResolvedValue([
        { conversationId: 'c1' },
      ]);

      await expect(
        repository.findParticipatedConversations('u1', ['c1', 'c2']),
      ).resolves.toEqual(new Set(['c1']));

      const [{ where }] = prisma.chatParticipant.findMany.mock.calls[0] as [
        { where: { state: { in: string[] } } },
      ];
      expect([...where.state.in].sort()).toEqual([
        'ACTIVE',
        'ARCHIVED',
        'BLOCKED',
        'JOINING',
        'LEAVING',
        'PENDING',
      ]);
    });
  });

  it('findPage scopes to the user and orders by createdAt then id', async () => {
    prisma.chatBackupBlob.findMany.mockResolvedValue([]);
    const createdAt = new Date(1);

    await repository.findPage('u1', { createdAt, id: 'x' }, 11);

    expect(prisma.chatBackupBlob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'u1',
          OR: [
            { createdAt: { gt: createdAt } },
            { createdAt, id: { gt: 'x' } },
          ],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 11,
      }),
    );
  });
});
