import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { MlsGroupRosterRepository } from '../mls-group-roster/mls-group-roster.repository';
import type { MlsGroupInfoRepository } from './mls-group-info.repository';

jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('../mls-group-roster/mls-group-roster.repository', () => ({
  MlsGroupRosterRepository: class {},
}));

import { MlsHandshakesRepository } from './mls-handshakes.repository';

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
    findLeavesAtEpoch: jest.fn(),
  };

  const groupInfos = { save: jest.fn() };

  let tx: ReturnType<typeof buildTx>;
  let prisma: {
    $transaction: jest.Mock;
    mlsHandshake: { findUnique: jest.Mock; findMany: jest.Mock };
    mlsWelcome: { findMany: jest.Mock; findFirst: jest.Mock };
    chatDevice: { findMany: jest.Mock };
    chatParticipant: { findUnique: jest.Mock };
    mlsCommitFault: { createMany: jest.Mock };
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
      mlsHandshake: { findUnique: jest.fn(), findMany: jest.fn() },
      mlsWelcome: { findMany: jest.fn(), findFirst: jest.fn() },
      mlsCommitFault: { createMany: jest.fn() },
      chatDevice: { findMany: jest.fn() },
      chatParticipant: { findUnique: jest.fn() },
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
      groupInfos as unknown as MlsGroupInfoRepository,
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
        signaturePublicKey: new Uint8Array([1, 2, 3]),
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

  describe('commit faults', () => {
    const fault = {
      conversationId: 'conv-1',
      epoch: 4,
      senderDeviceId: 'device-9',
      reporterDeviceId: 'device-2',
      reason: 'because',
    };

    it('records a fault, reporting whether it was new', async () => {
      prisma.mlsCommitFault.createMany.mockResolvedValue({ count: 1 });

      await expect(repository.recordCommitFault(fault)).resolves.toBe(true);
      expect(prisma.mlsCommitFault.createMany).toHaveBeenCalledWith({
        data: [fault],
        skipDuplicates: true,
      });
    });

    it('reports a repeat of the same fault from the same device as not new', async () => {
      prisma.mlsCommitFault.createMany.mockResolvedValue({ count: 0 });

      await expect(repository.recordCommitFault(fault)).resolves.toBe(false);
    });

    it('finds the handshake at an epoch, for its sender', async () => {
      prisma.mlsHandshake.findUnique.mockResolvedValue({
        senderDeviceId: 'device-9',
      });

      await expect(
        repository.findHandshakeByEpoch('conv-1', 4),
      ).resolves.toEqual({ senderDeviceId: 'device-9' });
      expect(prisma.mlsHandshake.findUnique).toHaveBeenCalledWith({
        where: { conversationId_epoch: { conversationId: 'conv-1', epoch: 4 } },
        select: { senderDeviceId: true },
      });
    });
  });

  it('ends the work lease when a Commit is accepted, since the Commit was the work', async () => {
    participants(['user-1', 'ACTIVE']);

    await repository.acceptHandshake(baseParams);

    expect(tx.chatConversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'conv-1', mlsEpoch: 0 },
      data: {
        mlsEpoch: { increment: 1 },
        mlsWorkLeaseDeviceId: null,
        mlsWorkLeaseUntil: null,
      },
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
        addedDevices: [],
        removedDevices: [],
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

    it('welcomes a pending invitee into the group it creates - PENDING is entitled to a leaf', async () => {
      devices(['device-2', 'user-2']);
      participants(['user-1', 'ACTIVE'], ['user-2', 'PENDING']);

      await expect(
        repository.acceptHandshake({
          ...baseParams,
          addedDeviceIds: ['device-2'],
          welcomes: [welcomeFor('device-2')],
        }),
      ).resolves.toMatchObject({ outcome: 'accepted' });

      expect(tx.mlsHandshake.create).toHaveBeenCalled();
      expect(tx.mlsWelcome.createMany).toHaveBeenCalled();
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

    it.each(['LEAVING', 'DECLINED'])(
      'refuses a Commit from a device whose user is %s, even though the device is still in the group',
      async (state) => {
        participants(['user-1', state]);

        await expect(repository.acceptHandshake(baseParams)).rejects.toThrow(
          ForbiddenException,
        );

        expect(tx.mlsHandshake.create).not.toHaveBeenCalled();
      },
    );

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

    it('adds a device for a pending invitee without changing their participant state', async () => {
      devices(['device-2', 'user-2']);
      participants(['user-1', 'ACTIVE'], ['user-2', 'PENDING']);

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
      expect(tx.chatParticipant.updateMany).not.toHaveBeenCalled();
    });

    it.each(['DECLINED', 'LEAVING', 'MISSING'])(
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

    it('stores what the server attests about the added and removed devices on the handshake', async () => {
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
        addedDevices: [
          {
            deviceId: 'device-2',
            userId: 'user-2',
            signaturePublicKey: Buffer.from([1, 2, 3]).toString('base64'),
          },
        ],
        removedDevices: [{ deviceId: 'device-3', userId: 'user-3' }],
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

  describe('a device joining by itself (external commit)', () => {
    const join = {
      conversationId: 'conv-1',
      expectedEpoch: 3,
      deviceId: 'device-2',
      userId: 'user-2',
      payload: new Uint8Array([7]),
      payloadSha256: 'hash-join',
      groupInfo: new Uint8Array([8]),
    };

    it('adds the device to the roster, activates its user and stores the snapshot, all in one transaction', async () => {
      devices(['device-2', 'user-2']);
      participants(['user-1', 'ACTIVE'], ['user-2', 'JOINING']);

      const result = await repository.acceptExternalJoin(join);

      expect(result.outcome).toBe('accepted');
      expect(roster.addLeaves).toHaveBeenCalledWith(
        'conv-1',
        [{ deviceId: 'device-2', userId: 'user-2' }],
        4,
        tx,
      );
      expect(tx.chatParticipant.updateMany).toHaveBeenCalledWith({
        where: { conversationId: 'conv-1', userId: 'user-2', state: 'JOINING' },
        data: { state: 'ACTIVE' },
      });
      expect(groupInfos.save).toHaveBeenCalledWith(
        'conv-1',
        4,
        join.groupInfo,
        tx,
      );
    });

    it('is recorded as sent by the joining device, with no Welcome, attesting the device it added', async () => {
      devices(['device-2', 'user-2']);
      participants(['user-1', 'ACTIVE'], ['user-2', 'JOINING']);

      await repository.acceptExternalJoin(join);

      expect(createdHandshakeData()).toMatchObject({
        senderDeviceId: 'device-2',
        addedDevices: [{ deviceId: 'device-2', userId: 'user-2' }],
        removedDevices: [],
      });
      expect(tx.mlsWelcome.createMany).not.toHaveBeenCalled();
    });

    it('does not need the joining device to be in the group already, or its user to be ACTIVE', async () => {
      devices(['device-2', 'user-2']);
      participants(['user-1', 'ACTIVE'], ['user-2', 'ARCHIVED']);

      await expect(repository.acceptExternalJoin(join)).resolves.toMatchObject({
        outcome: 'accepted',
      });
    });

    it('lets a still-pending invitee self-join, without changing their participant state', async () => {
      devices(['device-2', 'user-2']);
      participants(['user-1', 'ACTIVE'], ['user-2', 'PENDING']);

      await expect(repository.acceptExternalJoin(join)).resolves.toMatchObject({
        outcome: 'accepted',
      });
      expect(tx.chatParticipant.updateMany).not.toHaveBeenCalled();
    });

    it.each(['DECLINED', 'LEAVING', 'MISSING'])(
      'refuses a joiner whose user is %s',
      async (state) => {
        devices(['device-2', 'user-2']);
        participants(
          ['user-1', 'ACTIVE'],
          ...(state === 'MISSING'
            ? []
            : ([['user-2', state]] as Array<[string, string]>)),
        );

        await expect(repository.acceptExternalJoin(join)).rejects.toThrow(
          ForbiddenException,
        );
      },
    );

    it('refuses a revoked joining device', async () => {
      devices(['device-2', 'user-2', new Date()]);
      participants(['user-1', 'ACTIVE'], ['user-2', 'JOINING']);

      await expect(repository.acceptExternalJoin(join)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses to start a group: there has to be one to join', async () => {
      roster.hasRoster.mockResolvedValue(false);
      devices(['device-2', 'user-2']);
      participants(['user-2', 'JOINING']);

      await expect(
        repository.acceptExternalJoin({ ...join, expectedEpoch: 0 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('loses to another commit at the same epoch like any other, touching nothing', async () => {
      tx.chatConversation.updateMany.mockResolvedValue({ count: 0 });
      prisma.mlsHandshake.findUnique.mockResolvedValue({
        id: 'hs-winner',
        payloadSha256: 'some-other-hash',
      });

      const result = await repository.acceptExternalJoin(join);

      expect(result.outcome).toBe('conflict');
      expect(roster.addLeaves).not.toHaveBeenCalled();
      expect(groupInfos.save).not.toHaveBeenCalled();
    });
  });

  it('stores the snapshot a member Commit publishes, for the epoch it creates', async () => {
    devices();
    participants(['user-1', 'ACTIVE']);
    const groupInfo = new Uint8Array([5]);

    await repository.acceptHandshake({
      ...baseParams,
      expectedEpoch: 3,
      groupInfo,
    });

    expect(groupInfos.save).toHaveBeenCalledWith('conv-1', 4, groupInfo, tx);
  });

  describe('findRosterAtEpoch', () => {
    it('pairs each leaf with its registered key, and gives null for a device whose record is gone', async () => {
      roster.findLeavesAtEpoch.mockResolvedValue([
        { deviceId: 'd1', userId: 'u1' },
        { deviceId: 'd-gone', userId: 'u2' },
      ]);
      prisma.chatDevice.findMany.mockResolvedValue([
        { id: 'd1', signaturePublicKey: new Uint8Array([7]) },
      ]);

      await expect(repository.findRosterAtEpoch('conv-1', 2)).resolves.toEqual([
        {
          deviceId: 'd1',
          userId: 'u1',
          signaturePublicKey: new Uint8Array([7]),
        },
        { deviceId: 'd-gone', userId: 'u2', signaturePublicKey: null },
      ]);
      expect(roster.findLeavesAtEpoch).toHaveBeenCalledWith('conv-1', 2);
    });
  });

  describe('paging', () => {
    it('reads Commits in epoch order, capped at the limit', async () => {
      await repository.findHandshakesSince('conv-1', 3, 100);

      expect(prisma.mlsHandshake.findMany).toHaveBeenCalledWith({
        where: { conversationId: 'conv-1', epoch: { gte: 3 } },
        orderBy: { epoch: 'asc' },
        take: 100,
      });
    });

    it('reads Welcomes oldest first with id as tiebreak, capped at the limit', async () => {
      await repository.findPendingWelcomes('device-1', 50);

      expect(prisma.mlsWelcome.findMany).toHaveBeenCalledWith({
        where: { recipientDeviceId: 'device-1', consumedAt: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 50,
      });
    });

    it('resumes Welcomes strictly after the cursor welcome by (createdAt, id)', async () => {
      const createdAt = new Date('2026-01-01');
      prisma.mlsWelcome.findFirst.mockResolvedValue({ createdAt, id: 'w-9' });

      await repository.findPendingWelcomes('device-1', 50, 'w-9');

      expect(prisma.mlsWelcome.findFirst).toHaveBeenCalledWith({
        where: { id: 'w-9', recipientDeviceId: 'device-1' },
        select: { createdAt: true, id: true },
      });
      expect(prisma.mlsWelcome.findMany).toHaveBeenCalledWith({
        where: {
          recipientDeviceId: 'device-1',
          consumedAt: null,
          OR: [
            { createdAt: { gt: createdAt } },
            { createdAt, id: { gt: 'w-9' } },
          ],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 50,
      });
    });

    it('returns null, reading nothing, when the cursor is unknown to this device', async () => {
      prisma.mlsWelcome.findFirst.mockResolvedValue(null);

      await expect(
        repository.findPendingWelcomes('device-1', 50, 'w-x'),
      ).resolves.toBeNull();
      expect(prisma.mlsWelcome.findMany).not.toHaveBeenCalled();
    });
  });
});
