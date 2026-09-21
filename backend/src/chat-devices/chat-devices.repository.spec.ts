import type { PrismaService } from '../prisma/prisma.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class {},
}));

import { ChatDevicesRepository } from './chat-devices.repository';

describe('ChatDevicesRepository.revokeDevice', () => {
  const tx = {
    chatDevice: { updateMany: jest.fn() },
    session: { findMany: jest.fn(), deleteMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((callback: (t: typeof tx) => unknown) =>
      callback(tx),
    ),
  };

  let repository: ChatDevicesRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new ChatDevicesRepository(prisma as unknown as PrismaService);
  });

  it('revokes the device and ends the logins linked to it or not linked yet, not the one asking', async () => {
    tx.chatDevice.updateMany.mockResolvedValue({ count: 1 });
    tx.session.findMany.mockResolvedValue([
      { id: 's2', token: 't2' },
      { id: 's3', token: 't3' },
    ]);

    const result = await repository.revokeDevice(
      'device-1',
      'user-1',
      'session-1',
    );

    expect(tx.session.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        id: { not: 'session-1' },
        OR: [{ chatDeviceId: 'device-1' }, { chatDeviceId: null }],
      },
      select: { id: true, token: true },
    });
    expect(tx.session.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['s2', 's3'] } },
    });
    expect(result).toEqual({
      count: 1,
      endedSessions: [
        { id: 's2', token: 't2' },
        { id: 's3', token: 't3' },
      ],
    });
  });

  it('logs nobody out when no device of theirs matched', async () => {
    tx.chatDevice.updateMany.mockResolvedValue({ count: 0 });

    await repository.revokeDevice('device-1', 'user-1', 'session-1');

    expect(tx.session.deleteMany).not.toHaveBeenCalled();
    expect(tx.session.findMany).not.toHaveBeenCalled();
  });
});
