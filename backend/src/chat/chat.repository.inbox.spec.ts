import type { MlsGroupRosterRepository } from '../mls-group-roster/mls-group-roster.repository';
import type { PrismaService } from '../prisma/prisma.service';

jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('../mls-group-roster/mls-group-roster.repository', () => ({
  MlsGroupRosterRepository: class {},
}));

import { ChatRepository } from './chat.repository';

describe('ChatRepository inbox conversations', () => {
  const prisma = { chatConversation: { findMany: jest.fn() } };
  const repository = new ChatRepository(
    prisma as unknown as PrismaService,
    {} as MlsGroupRosterRepository,
  );

  it("gives each participant's name, @handle and picture, nothing more private", async () => {
    await repository.findInboxConversations('user-1', 'ACTIVE');

    expect(prisma.chatConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          participants: {
            include: {
              user: {
                select: { id: true, name: true, username: true, image: true },
              },
            },
          },
        }) as unknown,
      }),
    );
  });
});
