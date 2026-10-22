import type { MlsGroupRosterRepository } from '../mls-group-roster/mls-group-roster.repository';
import type { PrismaService } from '../prisma/prisma.service';

jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('../mls-group-roster/mls-group-roster.repository', () => ({
  MlsGroupRosterRepository: class {},
}));

import { ChatRepository } from './chat.repository';

describe('ChatRepository accepted chat partners', () => {
  const prisma = { chatParticipant: { findMany: jest.fn() } };
  const repository = new ChatRepository(
    prisma as unknown as PrismaService,
    {} as MlsGroupRosterRepository,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.chatParticipant.findMany.mockResolvedValue([
      { userId: 'bo' },
      { userId: 'cy' },
    ]);
  });

  it('is the people in a chat with this user, ACTIVE and not deleted on both sides', async () => {
    await expect(
      repository.findAcceptedChatPartnerIds('me', 500),
    ).resolves.toEqual(['bo', 'cy']);

    expect(prisma.chatParticipant.findMany).toHaveBeenCalledWith({
      where: {
        userId: { not: 'me' },
        state: 'ACTIVE',
        deletedAt: null,
        conversation: {
          participants: {
            some: { userId: 'me', state: 'ACTIVE', deletedAt: null },
          },
        },
      },
      select: { userId: true },
      distinct: ['userId'],
      take: 500,
    });
  });

  it('only looks at the people asked about, never the user themselves', async () => {
    await repository.findAcceptedChatPartnerIds('me', 10, ['bo', 'zed']);

    const [query] = prisma.chatParticipant.findMany.mock.calls[0] as [
      { where: { userId: unknown }; take: number },
    ];
    expect(query.where.userId).toEqual({ in: ['bo', 'zed'], not: 'me' });
    expect(query.take).toBe(10);
  });
});
