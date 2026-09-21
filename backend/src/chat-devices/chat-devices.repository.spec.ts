import type { PrismaService } from '../prisma/prisma.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class {},
}));

import { ChatDevicesRepository } from './chat-devices.repository';

describe('ChatDevicesRepository.revokeDevice', () => {
  const tx = {
    chatDevice: { updateMany: jest.fn() },
    session: { deleteMany: jest.fn() },
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

  it('revokes the device and logs the user out of every other session', async () => {
    tx.chatDevice.updateMany.mockResolvedValue({ count: 1 });

    await repository.revokeDevice('device-1', 'user-1', 'session-1');

    expect(tx.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', id: { not: 'session-1' } },
    });
  });

  it('logs nobody out when no device of theirs matched', async () => {
    tx.chatDevice.updateMany.mockResolvedValue({ count: 0 });

    await repository.revokeDevice('device-1', 'user-1', 'session-1');

    expect(tx.session.deleteMany).not.toHaveBeenCalled();
  });
});
