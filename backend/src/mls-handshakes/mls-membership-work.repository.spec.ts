import type { PrismaService } from '../prisma/prisma.service';

jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

import { MlsMembershipWorkRepository } from './mls-membership-work.repository';

describe('MlsMembershipWorkRepository', () => {
  const prisma = {
    chatConversation: { findMany: jest.fn() },
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
    it('only looks at conversations this device is in, this user is an ACTIVE participant of, and someone is joining or leaving', async () => {
      prisma.chatConversation.findMany.mockResolvedValue([]);

      await repository.findConversationsNeedingWork({
        deviceId: 'device-1',
        userId: 'user-1',
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
                  some: { state: { in: ['JOINING', 'LEAVING'] } },
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
        after: 'conv-7',
        limit: 50,
      });

      expect(queryArgs()).toMatchObject({
        where: { id: { gt: 'conv-7' } },
      });
    });

    it('selects only the joining and leaving participants and the live leaves', async () => {
      prisma.chatConversation.findMany.mockResolvedValue([]);

      await repository.findConversationsNeedingWork({
        deviceId: 'device-1',
        userId: 'user-1',
        limit: 50,
      });

      expect(queryArgs()).toMatchObject({
        select: {
          participants: {
            where: { state: { in: ['JOINING', 'LEAVING'] } },
            select: { userId: true, state: true },
          },
          mlsMembers: {
            where: { removedEpoch: null },
            select: { userId: true, deviceId: true },
          },
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

  describe('findUnrevokedDevicesOfUsers', () => {
    it('returns only devices that are not revoked', async () => {
      prisma.chatDevice.findMany.mockResolvedValue([
        { id: 'd1', userId: 'u2' },
      ]);

      await expect(
        repository.findUnrevokedDevicesOfUsers(['u2']),
      ).resolves.toEqual([{ userId: 'u2', deviceId: 'd1' }]);
      expect(prisma.chatDevice.findMany).toHaveBeenCalledWith({
        where: { userId: { in: ['u2'] }, revokedAt: null },
        select: { id: true, userId: true },
      });
    });
  });
});
