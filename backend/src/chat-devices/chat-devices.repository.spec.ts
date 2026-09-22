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
