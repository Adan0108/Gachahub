import { ConflictException } from '@nestjs/common';
import type { MlsGroupRosterRepository } from '../../mls-group-roster/mls-group-roster.repository';
import type { PrismaService } from '../../prisma/prisma.service';

jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('../../mls-group-roster/mls-group-roster.repository', () => ({
  MlsGroupRosterRepository: class {},
}));

import { ChatMembershipRepository } from './chat-membership.repository';

describe('ChatMembershipRepository', () => {
  const tx = {
    $queryRaw: jest.fn(),
    chatParticipant: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
      createMany: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn(),
    chatParticipant: { findMany: jest.fn() },
  };
  const roster = { hasRoster: jest.fn(), findActiveLeaves: jest.fn() };

  let repository: ChatMembershipRepository;
  const order: string[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    order.length = 0;
    tx.$queryRaw.mockImplementation(() => {
      order.push('lock');
      return Promise.resolve([]);
    });
    tx.chatParticipant.findMany.mockImplementation(() => {
      order.push('read participants');
      return Promise.resolve([]);
    });
    tx.chatParticipant.updateMany.mockResolvedValue({ count: 1 });
    tx.chatParticipant.createMany.mockResolvedValue({ count: 1 });
    roster.hasRoster.mockImplementation(() => {
      order.push('read roster');
      return Promise.resolve(true);
    });
    roster.findActiveLeaves.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(
      (callback: (t: typeof tx) => unknown) => callback(tx),
    );

    repository = new ChatMembershipRepository(
      prisma as unknown as PrismaService,
      roster as unknown as MlsGroupRosterRepository,
    );
  });

  it('locks the conversation before it reads anything, so a Commit cannot change the roster in between', async () => {
    await repository.changeMembership('conv-1', [
      { userId: 'u2', event: 'ADD_DIRECT' },
    ]);

    expect(order[0]).toBe('lock');
    expect(order.indexOf('lock')).toBeLessThan(order.indexOf('read roster'));
    expect(order.indexOf('lock')).toBeLessThan(
      order.indexOf('read participants'),
    );
  });

  it('reads the roster through the same transaction it writes in', async () => {
    await repository.changeMembership('conv-1', [
      { userId: 'u2', event: 'ADD_DIRECT' },
    ]);

    expect(roster.hasRoster).toHaveBeenCalledWith('conv-1', tx);
    expect(roster.findActiveLeaves).toHaveBeenCalledWith('conv-1', tx);
  });

  it('skips the leaf lookup when the conversation has no MLS group', async () => {
    roster.hasRoster.mockResolvedValue(false);

    await repository.changeMembership('conv-1', [
      { userId: 'u2', event: 'ADD_DIRECT' },
    ]);

    expect(roster.findActiveLeaves).not.toHaveBeenCalled();
  });

  it('applies what the plan decides and returns how many people changed', async () => {
    tx.chatParticipant.findMany.mockResolvedValue([
      { userId: 'u2', state: 'ACTIVE', role: 'MEMBER' },
    ]);
    roster.findActiveLeaves.mockResolvedValue([
      { userId: 'u2', deviceId: 'd2' },
    ]);

    await expect(
      repository.changeMembership('conv-1', [
        { userId: 'u2', event: 'REMOVE' },
      ]),
    ).resolves.toBe(1);

    expect(tx.chatParticipant.updateMany).toHaveBeenCalledWith({
      where: { conversationId: 'conv-1', userId: 'u2', state: 'ACTIVE' },
      data: { state: 'LEAVING' },
    });
  });

  it('declines at once, not LEAVING, when the person has no device in the group', async () => {
    tx.chatParticipant.findMany.mockResolvedValue([
      { userId: 'u2', state: 'ARCHIVED', role: 'MEMBER' },
    ]);
    roster.findActiveLeaves.mockResolvedValue([
      { userId: 'someone-else', deviceId: 'd9' },
    ]);

    await repository.changeMembership('conv-1', [
      { userId: 'u2', event: 'REMOVE' },
    ]);

    expect(tx.chatParticipant.updateMany).toHaveBeenCalledWith({
      where: { conversationId: 'conv-1', userId: 'u2', state: 'ARCHIVED' },
      data: { state: 'DECLINED' },
    });
  });

  it('propagates a conflict from a concurrent change so the whole change rolls back', async () => {
    tx.chatParticipant.findMany.mockResolvedValue([
      { userId: 'u2', state: 'ACTIVE', role: 'MEMBER' },
    ]);
    tx.chatParticipant.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      repository.changeMembership('conv-1', [
        { userId: 'u2', event: 'REMOVE' },
      ]),
    ).rejects.toThrow(ConflictException);
  });

  it('reads only the participants it was asked about', async () => {
    await repository.changeMembership('conv-1', [
      { userId: 'u2', event: 'ADD_DIRECT' },
      { userId: 'u3', event: 'ADD_DIRECT' },
    ]);

    expect(tx.chatParticipant.findMany).toHaveBeenCalledWith({
      where: { conversationId: 'conv-1', userId: { in: ['u2', 'u3'] } },
      select: { userId: true, state: true, role: true },
    });
  });

  it('passes onIllegal through, so a sweep can skip someone who answered instead of failing the batch', async () => {
    tx.chatParticipant.findMany.mockResolvedValue([
      { userId: 'u2', state: 'ACTIVE', role: 'MEMBER' },
      { userId: 'u3', state: 'PENDING', role: 'MEMBER' },
    ]);

    await expect(
      repository.changeMembership(
        'conv-1',
        [
          { userId: 'u2', event: 'EXPIRE_INVITE' },
          { userId: 'u3', event: 'EXPIRE_INVITE' },
        ],
        'skip',
      ),
    ).resolves.toBe(1);

    expect(tx.chatParticipant.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.chatParticipant.updateMany).toHaveBeenCalledWith({
      where: { conversationId: 'conv-1', userId: 'u3', state: 'PENDING' },
      data: { state: 'DECLINED' },
    });
  });

  describe('findExpiredPendingInvites', () => {
    it('queries PENDING participants updated before the cutoff', async () => {
      prisma.chatParticipant.findMany.mockResolvedValue([]);
      const cutoff = new Date('2026-09-01T00:00:00.000Z');

      await repository.findExpiredPendingInvites(cutoff);

      expect(prisma.chatParticipant.findMany).toHaveBeenCalledWith({
        where: { state: 'PENDING', updatedAt: { lt: cutoff } },
        select: { conversationId: true, userId: true },
      });
    });

    it('groups the matching userIds by conversation', async () => {
      prisma.chatParticipant.findMany.mockResolvedValue([
        { conversationId: 'conv-1', userId: 'u2' },
        { conversationId: 'conv-1', userId: 'u3' },
        { conversationId: 'conv-2', userId: 'u4' },
      ]);

      const result = await repository.findExpiredPendingInvites(new Date());

      expect(result).toEqual(
        new Map([
          ['conv-1', ['u2', 'u3']],
          ['conv-2', ['u4']],
        ]),
      );
    });

    it('returns an empty map when nothing has expired', async () => {
      prisma.chatParticipant.findMany.mockResolvedValue([]);

      const result = await repository.findExpiredPendingInvites(new Date());

      expect(result).toEqual(new Map());
    });
  });
});
