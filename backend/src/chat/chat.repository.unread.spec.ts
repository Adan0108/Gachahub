import type { MlsGroupRosterRepository } from '../mls-group-roster/mls-group-roster.repository';
import type { PrismaService } from '../prisma/prisma.service';

jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('../mls-group-roster/mls-group-roster.repository', () => ({
  MlsGroupRosterRepository: class {},
}));

import { ChatRepository } from './chat.repository';
import { notMutedParticipantWhere } from './notification-mute';

describe('ChatRepository global unread totals', () => {
  const prisma = {
    chatMessageReceipt: { count: jest.fn() },
    chatConversation: { count: jest.fn() },
  };
  const repository = new ChatRepository(
    prisma as unknown as PrismaService,
    {} as MlsGroupRosterRepository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    // Frozen so the filter's "now" matches the one the repository builds.
    jest.useFakeTimers().setSystemTime(new Date('2026-10-05T12:00:00.000Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('leaves muted conversations out of the unread message total', async () => {
    await repository.countUnreadMessagesForUser('user-1');

    expect(prisma.chatMessageReceipt.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        message: expect.objectContaining({
          conversation: {
            participants: {
              some: {
                userId: 'user-1',
                state: 'ACTIVE',
                deletedAt: null,
                ...notMutedParticipantWhere(),
              },
            },
          },
        }) as unknown,
      }) as unknown,
    });
  });

  it('leaves muted conversations out of the unread conversation total', async () => {
    await repository.countUnreadConversationsForUser('user-1');

    expect(prisma.chatConversation.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        participants: {
          some: {
            userId: 'user-1',
            state: 'ACTIVE',
            deletedAt: null,
            ...notMutedParticipantWhere(),
          },
        },
      }) as unknown,
    });
  });
});
