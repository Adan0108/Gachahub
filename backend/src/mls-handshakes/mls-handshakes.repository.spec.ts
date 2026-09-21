import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { MlsGroupRosterRepository } from '../mls-group-roster/mls-group-roster.repository';

jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('../mls-group-roster/mls-group-roster.repository', () => ({
  MlsGroupRosterRepository: class {},
}));

import { MlsHandshakesRepository } from './mls-handshakes.repository';

/**
 * acceptHandshake ties the roster and the participant rows to the Commit in
 * one transaction (threat-model §3), and its rules decide who may be added or
 * removed - security-sensitive enough for a direct test, mocking $transaction
 * rather than relying on the service layer to exercise it indirectly. The
 * rules themselves are covered case by case in mls-membership-rules.spec.ts;
 * this checks they are wired in and that everything happens atomically.
 */
describe('MlsHandshakesRepository.acceptHandshake', () => {
  function buildTx() {
    return {
      chatConversation: { updateMany: jest.fn() },
      chatDevice: { findMany: jest.fn().mockResolvedValue([]) },
      chatParticipant: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      mlsHandshake: { create: jest.fn() },
      mlsWelcome: { createMany: jest.fn() },
    };
  }

  const roster = {
    hasRoster: jest.fn(),
    findActiveLeaves: jest.fn(),
    addLeaves: jest.fn(),
    removeLeaves: jest.fn(),
  };

  let tx: ReturnType<typeof buildTx>;
  let prisma: {
    $transaction: jest.Mock;
    mlsHandshake: { findUnique: jest.Mock };
  };
  let repository: MlsHandshakesRepository;

  const baseParams = {
    conversationId: 'conv-1',
    expectedEpoch: 0,
    senderDeviceId: 'device-1',
    senderUserId: 'user-1',
    payload: new Uint8Array([1, 2, 3]),
    payloadSha256: 'hash-1',
    addedDeviceIds: [] as string[],
    removedDeviceIds: [] as string[],
    welcomes: [] as { recipientDeviceId: string; payload: Uint8Array }[],
  };

  const welcomeFor = (recipientDeviceId: string) => ({
    recipientDeviceId,
    payload: new Uint8Array([9]),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    tx = buildTx();
    prisma = {
      $transaction: jest.fn((callback: (t: typeof tx) => unknown) =>
        callback(tx),
      ),
      mlsHandshake: { findUnique: jest.fn() },
    };
    tx.chatConversation.updateMany.mockResolvedValue({ count: 1 });
    tx.mlsHandshake.create.mockImplementation(({ data }: { data: object }) =>
      Promise.resolve({ id: 'hs-1', createdAt: new Date(), ...data }),
    );
    // by default: a running group where device-1 (user-1) is the only member
    roster.hasRoster.mockResolvedValue(true);
    roster.findActiveLeaves.mockResolvedValue([
      { deviceId: 'device-1', userId: 'user-1' },
    ]);
    roster.removeLeaves.mockImplementation((_c: string, deviceIds: string[]) =>
      Promise.resolve(deviceIds.length),
    );

    repository = new MlsHandshakesRepository(
      prisma as unknown as PrismaService,
      roster as unknown as MlsGroupRosterRepository,
    );
  });

  const createdHandshakeData = (): unknown =>
    (tx.mlsHandshake.create.mock.calls[0] as [{ data: unknown }])[0].data;

  const participants = (...rows: Array<[string, string]>) =>
    tx.chatParticipant.findMany.mockResolvedValue(
      rows.map(([userId, state]) => ({ userId, state })),
    );

  const devices = (...rows: Array<[string, string] | [string, string, Date]>) =>
    tx.chatDevice.findMany.mockResolvedValue(
      rows.map(([id, userId, revokedAt]) => ({
        id,
        userId,
        revokedAt: revokedAt ?? null,
      })),
    );

  describe('epoch compare-and-set', () => {
    it('reports a duplicate when the CAS loses to an identical retry', async () => {
      tx.chatConversation.updateMany.mockResolvedValue({ count: 0 });
      prisma.mlsHandshake.findUnique.mockResolvedValue({
        id: 'hs-winner',
        payloadSha256: baseParams.payloadSha256,
      });

      const result = await repository.acceptHandshake(baseParams);

      expect(result.outcome).toBe('duplicate');
    });

    it('reports a conflict when the CAS loses to a different commit, without touching the roster', async () => {
      tx.chatConversation.updateMany.mockResolvedValue({ count: 0 });
      prisma.mlsHandshake.findUnique.mockResolvedValue({
        id: 'hs-winner',
        payloadSha256: 'some-other-hash',
      });

      const result = await repository.acceptHandshake(baseParams);

      expect(result.outcome).toBe('conflict');
      expect(roster.hasRoster).not.toHaveBeenCalled();
      expect(roster.addLeaves).not.toHaveBeenCalled();
      expect(roster.removeLeaves).not.toHaveBeenCalled();
    });
  });

  describe('a Commit that creates the group', () => {
    beforeEach(() => {
      roster.hasRoster.mockResolvedValue(false);
    });

    it('records the sender as the founder at epoch 0 and stores what was declared', async () => {
      participants(['user-1', 'ACTIVE']);

      const result = await repository.acceptHandshake(baseParams);

      expect(result.outcome).toBe('accepted');
      expect(roster.addLeaves).toHaveBeenCalledWith(
        'conv-1',
        [{ deviceId: 'device-1', userId: 'user-1' }],
        0,
        tx,
      );
      expect(createdHandshakeData()).toMatchObject({
        membershipDeclared: true,
        addedDeviceIds: [],
        removedDeviceIds: [],
      });
    });

    it('records added devices at the epoch the group reaches, and welcomes them', async () => {
      devices(['device-2', 'user-2']);
      participants(['user-1', 'ACTIVE'], ['user-2', 'ACTIVE']);

      await repository.acceptHandshake({
        ...baseParams,
        addedDeviceIds: ['device-2'],
        welcomes: [welcomeFor('device-2')],
      });

      expect(roster.addLeaves).toHaveBeenCalledWith(
        'conv-1',
        [{ deviceId: 'device-2', userId: 'user-2' }],
        1,
        tx,
      );
      expect(tx.mlsWelcome.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ recipientDeviceId: 'device-2' })],
      });
    });

    it('moves an ACTIVE member with no device in the new group to JOINING', async () => {
      devices(['device-2', 'user-2']);
      participants(
        ['user-1', 'ACTIVE'],
        ['user-2', 'ACTIVE'],
        ['user-3', 'ACTIVE'],
      );

      await repository.acceptHandshake({
        ...baseParams,
        addedDeviceIds: ['device-2'],
        welcomes: [welcomeFor('device-2')],
      });

      expect(tx.chatParticipant.updateMany).toHaveBeenCalledTimes(1);
      expect(tx.chatParticipant.updateMany).toHaveBeenCalledWith({
        where: {
          conversationId: 'conv-1',
          userId: 'user-3',
          state: 'ACTIVE',
        },
        data: { state: 'JOINING' },
      });
    });

    it('refuses to extend a group that already ran before membership was tracked', async () => {
      await expect(
        repository.acceptHandshake({ ...baseParams, expectedEpoch: 4 }),
      ).rejects.toThrow(BadRequestException);

      expect(tx.mlsHandshake.create).not.toHaveBeenCalled();
    });

    it('refuses to remove anyone from a group that has no one in it yet', async () => {
      devices(['device-9', 'user-9']);
      participants(['user-1', 'ACTIVE']);

      await expect(
        repository.acceptHandshake({
          ...baseParams,
          removedDeviceIds: ['device-9'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses to welcome someone who is only PENDING - a Commit cannot grant membership', async () => {
      devices(['device-2', 'user-2']);
      participants(['user-1', 'ACTIVE'], ['user-2', 'PENDING']);

      await expect(
        repository.acceptHandshake({
          ...baseParams,
          addedDeviceIds: ['device-2'],
          welcomes: [welcomeFor('device-2')],
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(tx.mlsHandshake.create).not.toHaveBeenCalled();
      expect(tx.mlsWelcome.createMany).not.toHaveBeenCalled();
    });
  });

  describe('a Commit on a running group', () => {
    it('refuses a Commit from a device that is not in the group', async () => {
      roster.findActiveLeaves.mockResolvedValue([
        { deviceId: 'someone-else', userId: 'user-9' },
      ]);

      await expect(repository.acceptHandshake(baseParams)).rejects.toThrow(
        ForbiddenException,
      );

      expect(tx.mlsHandshake.create).not.toHaveBeenCalled();
    });

    it('adds a device for someone waiting to join and activates them in the same transaction', async () => {
      devices(['device-2', 'user-2']);
      participants(['user-1', 'ACTIVE'], ['user-2', 'JOINING']);

      await repository.acceptHandshake({
        ...baseParams,
        expectedEpoch: 3,
        addedDeviceIds: ['device-2'],
        welcomes: [welcomeFor('device-2')],
      });

      expect(roster.addLeaves).toHaveBeenCalledWith(
        'conv-1',
        [{ deviceId: 'device-2', userId: 'user-2' }],
        4,
        tx,
      );
      expect(tx.chatParticipant.updateMany).toHaveBeenCalledWith({
        where: {
          conversationId: 'conv-1',
          userId: 'user-2',
          state: 'JOINING',
        },
        data: { state: 'ACTIVE' },
      });
    });

    it.each(['PENDING', 'DECLINED', 'LEAVING', 'MISSING'])(
      'refuses to add a device for someone who is %s',
      async (state) => {
        devices(['device-2', 'user-2']);
        participants(
          ['user-1', 'ACTIVE'],
          ...(state === 'MISSING'
            ? []
            : ([['user-2', state]] as Array<[string, string]>)),
        );

        await expect(
          repository.acceptHandshake({
            ...baseParams,
            addedDeviceIds: ['device-2'],
            welcomes: [welcomeFor('device-2')],
          }),
        ).rejects.toThrow(ForbiddenException);
      },
    );

    it('refuses to add a revoked device even for an active member', async () => {
      devices(['device-2', 'user-2', new Date()]);
      participants(['user-1', 'ACTIVE'], ['user-2', 'ACTIVE']);

      await expect(
        repository.acceptHandshake({
          ...baseParams,
          addedDeviceIds: ['device-2'],
          welcomes: [welcomeFor('device-2')],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses to add a device that does not exist', async () => {
      participants(['user-1', 'ACTIVE']);

      await expect(
        repository.acceptHandshake({
          ...baseParams,
          addedDeviceIds: ['ghost'],
          welcomes: [welcomeFor('ghost')],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('removes the devices of someone leaving and finishes their removal in the same transaction', async () => {
      roster.findActiveLeaves.mockResolvedValue([
        { deviceId: 'device-1', userId: 'user-1' },
        { deviceId: 'device-2', userId: 'user-2' },
      ]);
      devices(['device-2', 'user-2']);
      participants(['user-1', 'ACTIVE'], ['user-2', 'LEAVING']);

      await repository.acceptHandshake({
        ...baseParams,
        expectedEpoch: 5,
        removedDeviceIds: ['device-2'],
      });

      expect(roster.removeLeaves).toHaveBeenCalledWith(
        'conv-1',
        ['device-2'],
        6,
        tx,
      );
      expect(tx.chatParticipant.updateMany).toHaveBeenCalledWith({
        where: {
          conversationId: 'conv-1',
          userId: 'user-2',
          state: 'LEAVING',
        },
        data: { state: 'DECLINED' },
      });
    });

    it('does not finish someone’s removal while another of their devices is still in the group', async () => {
      roster.findActiveLeaves.mockResolvedValue([
        { deviceId: 'device-1', userId: 'user-1' },
        { deviceId: 'device-2', userId: 'user-2' },
        { deviceId: 'device-3', userId: 'user-2' },
      ]);
      devices(['device-2', 'user-2']);
      participants(['user-1', 'ACTIVE'], ['user-2', 'LEAVING']);

      await repository.acceptHandshake({
        ...baseParams,
        removedDeviceIds: ['device-2'],
      });

      expect(tx.chatParticipant.updateMany).not.toHaveBeenCalled();
    });

    it('refuses to remove a working device of a member who is entitled to stay', async () => {
      roster.findActiveLeaves.mockResolvedValue([
        { deviceId: 'device-1', userId: 'user-1' },
        { deviceId: 'device-2', userId: 'user-2' },
      ]);
      devices(['device-2', 'user-2']);
      participants(['user-1', 'ACTIVE'], ['user-2', 'ACTIVE']);

      await expect(
        repository.acceptHandshake({
          ...baseParams,
          removedDeviceIds: ['device-2'],
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(roster.removeLeaves).not.toHaveBeenCalled();
      expect(tx.mlsHandshake.create).not.toHaveBeenCalled();
    });

    it('fails, rolling back, if a leaf it was asked to remove is no longer in the roster', async () => {
      roster.findActiveLeaves.mockResolvedValue([
        { deviceId: 'device-1', userId: 'user-1' },
        { deviceId: 'device-2', userId: 'user-2' },
      ]);
      devices(['device-2', 'user-2']);
      participants(['user-1', 'ACTIVE'], ['user-2', 'LEAVING']);
      roster.removeLeaves.mockResolvedValue(0);

      await expect(
        repository.acceptHandshake({
          ...baseParams,
          removedDeviceIds: ['device-2'],
        }),
      ).rejects.toThrow(ConflictException);

      expect(tx.mlsHandshake.create).not.toHaveBeenCalled();
    });

    it('stores exactly what the sender declared on the handshake', async () => {
      roster.findActiveLeaves.mockResolvedValue([
        { deviceId: 'device-1', userId: 'user-1' },
        { deviceId: 'device-3', userId: 'user-3' },
      ]);
      devices(['device-2', 'user-2'], ['device-3', 'user-3']);
      participants(
        ['user-1', 'ACTIVE'],
        ['user-2', 'JOINING'],
        ['user-3', 'LEAVING'],
      );

      await repository.acceptHandshake({
        ...baseParams,
        addedDeviceIds: ['device-2'],
        removedDeviceIds: ['device-3'],
        welcomes: [welcomeFor('device-2')],
      });

      expect(createdHandshakeData()).toMatchObject({
        membershipDeclared: true,
        addedDeviceIds: ['device-2'],
        removedDeviceIds: ['device-3'],
      });
    });

    it('accepts a Commit that changes no one, writing no roster or participant rows', async () => {
      participants(['user-1', 'ACTIVE']);

      const result = await repository.acceptHandshake(baseParams);

      expect(result.outcome).toBe('accepted');
      expect(roster.addLeaves).toHaveBeenCalledWith('conv-1', [], 1, tx);
      expect(tx.chatParticipant.updateMany).not.toHaveBeenCalled();
    });
  });
});
