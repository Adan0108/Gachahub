jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
import { CommunityRealtimeService } from './community-realtime.service';

it('drops ephemeral delivery on authorization lookup failure without failing an already committed write', async () => {
  const emit = jest.fn();
  const server = {
    in: () => ({
      fetchSockets: () =>
        Promise.resolve([
          {
            data: { userId: 'reader', sessionExpiresAt: Date.now() + 60000 },
            emit,
          },
        ]),
    }),
  };
  const service = new CommunityRealtimeService(
    { server } as never,
    {
      gameChannel: { findUnique: () => Promise.resolve({ gameId: 'game' }) },
    } as never,
    {
      blockedReaders: () =>
        Promise.reject(new Error('Private database detail')),
    } as never,
  );
  await expect(service.changed('channel', 'message')).resolves.toBeUndefined();
  expect(emit).not.toHaveBeenCalled();
});

it('filters and removes an already joined banned socket before sending activity', async () => {
  const socket = (id: string) => ({
    data: { userId: id, sessionExpiresAt: Date.now() + 60000 },
    emit: jest.fn(),
    leave: jest.fn(),
  });
  const banned = socket('banned'),
    reader = socket('reader');
  const server = {
    in: () => ({ fetchSockets: () => Promise.resolve([banned, reader]) }),
    to: jest.fn(() => ({ emit: jest.fn() })),
  };
  const sanctions = {
    blockedReaders: jest.fn(() => Promise.resolve(new Set(['banned']))),
  };
  const service = new CommunityRealtimeService(
    { server } as never,
    {
      gameChannel: { findUnique: () => Promise.resolve({ gameId: 'game' }) },
    } as never,
    sanctions as never,
  );
  await service.changed('channel', 'message');
  expect(server.to).not.toHaveBeenCalled();
  expect(banned.emit).not.toHaveBeenCalled();
  expect(banned.leave).toHaveBeenCalledWith('community:channel');
  expect(reader.emit).toHaveBeenCalledWith('community:activity', {
    channelId: 'channel',
    messageId: 'message',
  });
  expect(sanctions.blockedReaders).toHaveBeenCalledWith(
    ['banned', 'reader'],
    'game',
  );
});
