import type { PrismaService } from '../prisma/prisma.service';

jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

import { MlsMembershipWorkRepository } from './mls-membership-work.repository';

describe('MlsMembershipWorkRepository', () => {
  const prisma = {
    chatConversation: { findMany: jest.fn(), updateMany: jest.fn() },
    chatDevice: { findMany: jest.fn() },
  };

  let repository: MlsMembershipWorkRepository;

  const queryArgs = (): unknown =>
    (prisma.chatConversation.findMany.mock.calls[0] as [unknown])[0];

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new MlsMembershipWorkRepository(
      prisma as unknown as PrismaService,
    );
  });

  describe('findConversationsNeedingWork', () => {
    it('only looks at conversations this device is in, this user is an ACTIVE participant of, and someone is pending, joining or leaving', async () => {
      prisma.chatConversation.findMany.mockResolvedValue([]);

      await repository.findConversationsNeedingWork({
        deviceId: 'device-1',
        userId: 'user-1',
        scope: 'pending',
        limit: 50,
      });

      expect(prisma.chatConversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            mlsMembers: { some: { deviceId: 'device-1', removedEpoch: null } },
            AND: [
              { participants: { some: { userId: 'user-1', state: 'ACTIVE' } } },
              {
                participants: {
                  some: { state: { in: ['PENDING', 'JOINING', 'LEAVING'] } },
                },
              },
            ],
          },
          orderBy: { id: 'asc' },
          take: 50,
        }),
      );
    });

    it('starts after the cursor when given one', async () => {
      prisma.chatConversation.findMany.mockResolvedValue([]);

      await repository.findConversationsNeedingWork({
        deviceId: 'device-1',
        userId: 'user-1',
        scope: 'pending',
        after: 'conv-7',
        limit: 50,
      });

      expect(queryArgs()).toMatchObject({
        where: { id: { gt: 'conv-7' } },
      });
    });

    it('can be narrowed to a single conversation', async () => {
      prisma.chatConversation.findMany.mockResolvedValue([]);

      await repository.findConversationsNeedingWork({
        deviceId: 'device-1',
        userId: 'user-1',
        scope: 'pending',
        conversationId: 'conv-3',
        limit: 50,
      });

      expect(queryArgs()).toMatchObject({ where: { id: 'conv-3' } });
    });

    it('selects ALL the participants and the live leaves - a member left out would look like someone with no right to be there', async () => {
      prisma.chatConversation.findMany.mockResolvedValue([]);

      await repository.findConversationsNeedingWork({
        deviceId: 'device-1',
        userId: 'user-1',
        scope: 'pending',
        limit: 50,
      });

      expect(queryArgs()).toMatchObject({
        select: {
          participants: { select: { userId: true, state: true } },
          mlsMembers: {
            where: { removedEpoch: null },
            select: { userId: true, deviceId: true },
          },
        },
      });
      expect(
        (queryArgs() as { select: { participants: object } }).select
          .participants,
      ).not.toHaveProperty('where');
    });

    it('looks in every conversation this device is in when asked for the full scope', async () => {
      prisma.chatConversation.findMany.mockResolvedValue([]);

      await repository.findConversationsNeedingWork({
        deviceId: 'device-1',
        userId: 'user-1',
        scope: 'full',
        limit: 50,
      });

      expect(queryArgs()).toMatchObject({
        where: {
          mlsMembers: { some: { deviceId: 'device-1', removedEpoch: null } },
          AND: [
            { participants: { some: { userId: 'user-1', state: 'ACTIVE' } } },
          ],
        },
      });
    });

    it('maps rows into the shape the work builder expects', async () => {
      prisma.chatConversation.findMany.mockResolvedValue([
        {
          id: 'conv-1',
          mlsEpoch: 3,
          participants: [{ userId: 'u2', state: 'JOINING' }],
          mlsMembers: [{ userId: 'me', deviceId: 'my-device' }],
        },
      ]);

      await expect(
        repository.findConversationsNeedingWork({
          deviceId: 'my-device',
          userId: 'me',
          scope: 'pending',
          limit: 50,
        }),
      ).resolves.toEqual([
        {
          id: 'conv-1',
          mlsEpoch: 3,
          participants: [{ userId: 'u2', state: 'JOINING' }],
          activeLeaves: [{ userId: 'me', deviceId: 'my-device' }],
        },
      ]);
    });
  });

  describe('leaseConversations', () => {
    const now = new Date('2026-09-22T10:00:00Z');
    const until = new Date('2026-09-22T10:01:00Z');

    it('takes a conversation nobody holds, or whose lease ended - never refreshing its own, and not straight back after it let one end', async () => {
      prisma.chatConversation.updateMany.mockResolvedValue({ count: 1 });
      prisma.chatConversation.findMany.mockResolvedValue([{ id: 'conv-1' }]);

      const held = await repository.leaseConversations({
        deviceId: 'device-1',
        conversationIds: ['conv-1', 'conv-2'],
        now,
        until,
        cooldownMs: 120_000,
      });

      expect(prisma.chatConversation.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['conv-1', 'conv-2'] },
          OR: [
            { mlsWorkLeaseUntil: null },
            { mlsWorkLeaseUntil: { lt: new Date('2026-09-22T09:58:00Z') } },
            {
              mlsWorkLeaseUntil: { lt: now },
              mlsWorkLeaseDeviceId: { not: 'device-1' },
            },
          ],
        },
        data: { mlsWorkLeaseDeviceId: 'device-1', mlsWorkLeaseUntil: until },
      });
      expect([...held]).toEqual(['conv-1']);
    });

    it('reports as held only what this device holds a live lease on', async () => {
      prisma.chatConversation.updateMany.mockResolvedValue({ count: 0 });
      prisma.chatConversation.findMany.mockResolvedValue([]);

      const held = await repository.leaseConversations({
        deviceId: 'device-1',
        conversationIds: ['conv-1'],
        now,
        until,
        cooldownMs: 120_000,
      });

      expect(prisma.chatConversation.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['conv-1'] },
          mlsWorkLeaseDeviceId: 'device-1',
          mlsWorkLeaseUntil: { gt: now },
        },
        select: { id: true },
      });
      expect(held.size).toBe(0);
    });
  });

  describe('releaseLease', () => {
    it('ends only this device’s own lease, leaving it as the last holder', async () => {
      prisma.chatConversation.updateMany.mockResolvedValue({ count: 1 });
      const now = new Date('2026-09-22T10:00:00Z');

      await repository.releaseLease({
        deviceId: 'device-1',
        conversationId: 'conv-1',
        now,
      });

      expect(prisma.chatConversation.updateMany).toHaveBeenCalledWith({
        where: { id: 'conv-1', mlsWorkLeaseDeviceId: 'device-1' },
        data: { mlsWorkLeaseUntil: now },
      });
    });
  });

  describe('findDevices', () => {
    it('returns the devices of these users and these devices, revoked or not, so a revoked leaf can be told from a working one', async () => {
      prisma.chatDevice.findMany.mockResolvedValue([
        { id: 'd1', userId: 'u2', revokedAt: null },
        { id: 'd2', userId: 'u2', revokedAt: new Date() },
      ]);

      await expect(
        repository.findDevices({ userIds: ['u2'], deviceIds: ['d9'] }),
      ).resolves.toEqual([
        { userId: 'u2', deviceId: 'd1', revoked: false },
        { userId: 'u2', deviceId: 'd2', revoked: true },
      ]);
      expect(prisma.chatDevice.findMany).toHaveBeenCalledWith({
        where: { OR: [{ userId: { in: ['u2'] } }, { id: { in: ['d9'] } }] },
        select: { id: true, userId: true, revokedAt: true },
      });
    });
  });
});
