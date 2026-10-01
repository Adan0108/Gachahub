import type { PrismaService } from '../prisma/prisma.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class {},
}));

import { ChatDevicesRepository } from './chat-devices.repository';

describe('ChatDevicesRepository.revokeDevice', () => {
  const prisma = { chatDevice: { updateMany: jest.fn() } };
  let repository: ChatDevicesRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new ChatDevicesRepository(prisma as unknown as PrismaService);
  });

  it('only marks the device revoked - it does not touch any login', async () => {
    await repository.revokeDevice('device-1', 'user-1');

    expect(prisma.chatDevice.updateMany).toHaveBeenCalledWith({
      where: { id: 'device-1', userId: 'user-1' },
      data: { revokedAt: expect.any(Date) as Date },
    });
  });
});

describe('ChatDevicesRepository.findLoginsOfDevice', () => {
  const prisma = {
    session: { findFirst: jest.fn(), findMany: jest.fn() },
  };
  let repository: ChatDevicesRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new ChatDevicesRepository(prisma as unknown as PrismaService);
    prisma.session.findMany.mockResolvedValue([{ id: 's2', token: 't2' }]);
  });

  it('finds the logins linked to the device, not the one asking', async () => {
    prisma.session.findFirst.mockResolvedValue({
      chatDeviceId: 'other-device',
    });

    await expect(
      repository.findLoginsOfDevice('device-1', 'user-1', 'session-1'),
    ).resolves.toEqual([{ id: 's2', token: 't2' }]);

    expect(prisma.session.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        chatDeviceId: 'device-1',
        id: { not: 'session-1' },
      },
      select: { id: true, token: true },
    });
  });

  it('includes the caller login when it is the device being signed out', async () => {
    prisma.session.findFirst.mockResolvedValue({ chatDeviceId: 'device-1' });

    await repository.findLoginsOfDevice('device-1', 'user-1', 'session-1');

    expect(prisma.session.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', chatDeviceId: 'device-1' },
      select: { id: true, token: true },
    });
  });
});

describe('ChatDevicesRepository.linkSession', () => {
  const prisma = {
    session: { updateMany: jest.fn(), findFirst: jest.fn() },
  };
  let repository: ChatDevicesRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new ChatDevicesRepository(prisma as unknown as PrismaService);
  });

  it('links a login only while it is not linked to any device', async () => {
    await repository.linkSession('session-1', 'user-1', 'device-1');

    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { id: 'session-1', userId: 'user-1', chatDeviceId: null },
      data: { chatDeviceId: 'device-1' },
    });
  });

  it('relinks only while the login still points at the device it was decided against', async () => {
    await repository.relinkSession(
      'session-1',
      'user-1',
      'device-2',
      'device-1',
    );

    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { id: 'session-1', userId: 'user-1', chatDeviceId: 'device-1' },
      data: { chatDeviceId: 'device-2' },
    });
  });

  it('reads which device a login is linked to, or null', async () => {
    prisma.session.findFirst.mockResolvedValueOnce({
      chatDeviceId: 'device-1',
    });
    prisma.session.findFirst.mockResolvedValueOnce(null);

    await expect(
      repository.findSessionDeviceId('session-1', 'user-1'),
    ).resolves.toBe('device-1');
    await expect(
      repository.findSessionDeviceId('session-2', 'user-1'),
    ).resolves.toBeNull();
  });
});

describe('ChatDevicesRepository.createDeviceWithinCap', () => {
  const tx = {
    $queryRaw: jest.fn(),
    chatDevice: {
      findUnique: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    mlsKeyPackage: { createMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  let repository: ChatDevicesRepository;

  const params = {
    deviceId: 'device-11',
    userId: 'user-1',
    signaturePublicKey: new Uint8Array([1]),
    ciphersuite: 'suite',
    keyPackages: [],
  };
  const cap = { maxActive: 10, evictIdleBefore: new Date('2026-01-01') };

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new ChatDevicesRepository(prisma as unknown as PrismaService);
    tx.chatDevice.findUnique.mockResolvedValue(null);
    tx.chatDevice.count.mockResolvedValue(3);
    tx.chatDevice.create.mockResolvedValue({ id: 'device-11' });
  });

  it('locks the user row before counting, then creates the device', async () => {
    await expect(
      repository.createDeviceWithinCap(params, cap),
    ).resolves.toEqual({
      outcome: 'created',
      device: { id: 'device-11' },
    });

    const [lockSql] = tx.$queryRaw.mock.calls[0] as [string[]];
    expect(lockSql.join('')).toContain('FOR NO KEY UPDATE');
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.chatDevice.count.mock.invocationCallOrder[0],
    );
    expect(tx.chatDevice.updateMany).not.toHaveBeenCalled();
  });

  it('reports an id that already exists without creating', async () => {
    tx.chatDevice.findUnique.mockResolvedValue({ id: 'device-11' });

    await expect(
      repository.createDeviceWithinCap(params, cap),
    ).resolves.toEqual({ outcome: 'exists' });
    expect(tx.chatDevice.create).not.toHaveBeenCalled();
  });

  it('retires the stalest device at the cap when it has been idle long enough', async () => {
    tx.chatDevice.count.mockResolvedValue(10);
    tx.chatDevice.findFirst.mockResolvedValue({
      id: 'zombie',
      lastSeenAt: new Date('2025-01-01'),
    });

    await expect(
      repository.createDeviceWithinCap(params, cap),
    ).resolves.toMatchObject({ outcome: 'created' });
    expect(tx.chatDevice.updateMany).toHaveBeenCalledWith({
      where: { id: 'zombie', userId: 'user-1' },
      data: { revokedAt: expect.any(Date) as Date },
    });
  });

  it('refuses at the cap when every device was used recently, retiring nothing', async () => {
    tx.chatDevice.count.mockResolvedValue(10);
    tx.chatDevice.findFirst.mockResolvedValue({
      id: 'busy',
      lastSeenAt: new Date('2026-06-01'),
    });

    await expect(
      repository.createDeviceWithinCap(params, cap),
    ).resolves.toEqual({ outcome: 'cap-reached' });
    expect(tx.chatDevice.updateMany).not.toHaveBeenCalled();
    expect(tx.chatDevice.create).not.toHaveBeenCalled();
  });
});

describe('ChatDevicesRepository.countClaimableSingleUseKeyPackages', () => {
  it('counts only unclaimed, unexpired SINGLE_USE packages of the device', async () => {
    const prisma = { mlsKeyPackage: { count: jest.fn().mockResolvedValue(4) } };
    const repository = new ChatDevicesRepository(
      prisma as unknown as PrismaService,
    );

    await expect(
      repository.countClaimableSingleUseKeyPackages('device-1'),
    ).resolves.toBe(4);

    expect(prisma.mlsKeyPackage.count).toHaveBeenCalledWith({
      where: {
        deviceId: 'device-1',
        kind: 'SINGLE_USE',
        claimedAt: null,
        expiresAt: { gt: expect.any(Date) as Date },
      },
    });
  });
});
