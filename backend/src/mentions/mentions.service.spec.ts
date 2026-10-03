import type { Prisma } from '../generated/prisma/client';
import type { EventPublisherPort } from '../domain-events/event-publisher.port';
import { MentionsService } from './mentions.service';

describe('MentionsService', () => {
  const eventPublisher = { publishMany: jest.fn() };
  const transaction = {
    user: { findMany: jest.fn() },
  };
  const service = new MentionsService(
    eventPublisher as unknown as EventPublisherPort,
  );
  const tx = transaction as unknown as Prisma.TransactionClient;
  const base = {
    actorId: 'me',
    entityType: 'COMMENT' as const,
    entityId: 'c1',
  };

  beforeEach(() => jest.clearAllMocks());

  it('does nothing when the text has no mentions', async () => {
    await service.publishMentions(
      { ...base, text: 'plain', canView: () => Promise.resolve(true) },
      tx,
    );

    expect(transaction.user.findMany).not.toHaveBeenCalled();
    expect(eventPublisher.publishMany).not.toHaveBeenCalled();
  });

  it('only looks up active, non-blocked users other than the author', async () => {
    transaction.user.findMany.mockResolvedValue([]);

    await service.publishMentions(
      { ...base, text: 'hi @bob', canView: () => Promise.resolve(true) },
      tx,
    );

    expect(transaction.user.findMany).toHaveBeenCalledWith({
      where: {
        username: { in: ['bob'] },
        id: { not: 'me' },
        status: 'ACTIVE',
        blockedUsers: { none: { blockedId: 'me' } },
        blockedBy: { none: { blockerId: 'me' } },
      },
      select: { id: true, username: true },
    });
  });

  it('emits one user.mentioned per mentioned user who can view it', async () => {
    transaction.user.findMany.mockResolvedValue([
      { id: 'u1', username: 'bob' },
      { id: 'u2', username: 'amy' },
    ]);

    await service.publishMentions(
      {
        ...base,
        text: '@bob @amy',
        canView: (id) => Promise.resolve(id === 'u1'),
      },
      tx,
    );

    expect(eventPublisher.publishMany).toHaveBeenCalledWith(
      [
        {
          type: 'user.mentioned',
          aggregateId: 'c1',
          payload: {
            targetUserId: 'u1',
            actorId: 'me',
            entityType: 'COMMENT',
            entityId: 'c1',
          },
        },
      ],
      tx,
    );
  });

  describe('on edit (previous text given)', () => {
    const users = [
      { id: 'u1', username: 'Bob' },
      { id: 'u2', username: 'amy' },
    ];

    it('pings only users newly mentioned since the old text', async () => {
      transaction.user.findMany.mockResolvedValue(users);

      await service.publishMentions(
        {
          ...base,
          text: 'hi @bob and @amy',
          canView: () => Promise.resolve(true),
          previous: { text: 'hi @BOB', canView: () => Promise.resolve(true) },
        },
        tx,
      );

      const [events] = eventPublisher.publishMany.mock.calls[0] as [
        { payload: { targetUserId: string } }[],
      ];
      expect(events.map((e) => e.payload.targetUserId)).toEqual(['u2']);
    });

    it('pings again someone who could not see the old version', async () => {
      transaction.user.findMany.mockResolvedValue(users.slice(0, 1));

      await service.publishMentions(
        {
          ...base,
          text: 'hi @bob',
          canView: () => Promise.resolve(true),
          previous: { text: 'hi @bob', canView: () => Promise.resolve(false) },
        },
        tx,
      );

      const [events] = eventPublisher.publishMany.mock.calls[0] as [
        { payload: { targetUserId: string } }[],
      ];
      expect(events.map((e) => e.payload.targetUserId)).toEqual(['u1']);
    });
  });
});
