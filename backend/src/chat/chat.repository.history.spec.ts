import type { MlsGroupRosterRepository } from '../mls-group-roster/mls-group-roster.repository';
import type { PrismaService } from '../prisma/prisma.service';

jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('../mls-group-roster/mls-group-roster.repository', () => ({
  MlsGroupRosterRepository: class {},
}));

import { ChatRepository } from './chat.repository';

// #96: every cursor the history API hands out must work as the next page's boundary.
describe('ChatRepository history paging', () => {
  const prisma = {
    chatMessage: { findFirst: jest.fn(), findMany: jest.fn() },
  };
  const repository = new ChatRepository(
    prisma as unknown as PrismaService,
    {} as MlsGroupRosterRepository,
  );
  beforeEach(() => jest.clearAllMocks());

  it('finds a boundary message whatever it is - an edit or a deleted message - but only in this conversation', async () => {
    await repository.findMessagePosition('edit-9', 'conversation-1');

    const [{ where }] = prisma.chatMessage.findFirst.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(where).toEqual({ id: 'edit-9', conversationId: 'conversation-1' });
  });

  it('pages strictly before the boundary by (createdAt, id), with no cursor row to skip', async () => {
    const createdAt = new Date('2026-10-20T10:00:00.000Z');

    await repository.findMessages({
      conversationId: 'conversation-1',
      before: { id: 'deleted-4', createdAt },
      limit: 50,
    });

    const [args] = prisma.chatMessage.findMany.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(args).not.toHaveProperty('cursor');
    expect(args).not.toHaveProperty('skip');
    expect(args.where).toEqual({
      conversationId: 'conversation-1',
      status: 'SENT',
      OR: [
        { createdAt: { lt: createdAt } },
        { createdAt, id: { lt: 'deleted-4' } },
      ],
    });
  });
});
