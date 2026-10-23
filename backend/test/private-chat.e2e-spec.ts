import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { BlocksRepository } from '../src/blocks/blocks.repository';
import { BlocksService } from '../src/blocks/blocks.service';
import { ChatAccessService } from '../src/chat/chat-access.service';
import { ChatHistoryFetchRateLimiterService } from '../src/chat/chat-history-fetch-rate-limiter.service';
import { ChatInboxService } from '../src/chat/chat-inbox.service';
import { ChatRepository } from '../src/chat/chat.repository';
import { ChatMembershipService } from '../src/chat/membership/chat-membership.service';
import { CHAT_DELIVERY_PORT } from '../src/chat/ports/chat-delivery.port';
import { FollowsService } from '../src/follows/follows.service';
import { GameModeratorsService } from '../src/game-moderators/game-moderators.service';
import { MlsGroupRosterRepository } from '../src/mls-group-roster/mls-group-roster.repository';
import { PrismaService } from '../src/prisma/prisma.service';

// Real PostgreSQL. Run it against a throwaway database (DATABASE_URL), never the shared one;
// CI runs it against its own (.github/workflows/backend.yml). #105.
describe('Private chat (real database)', () => {
  jest.setTimeout(120_000);
  let app: INestApplication;
  let db: PrismaService;
  let chats: ChatRepository;
  let inbox: ChatInboxService;
  const token = randomUUID().slice(0, 8);
  const id = (name: string) => `pc-${name}-${token}`;
  const me = id('me');
  const friends = Array.from({ length: 7 }, (_, i) => id(`friend${i}`));
  const users = [me, ...friends];
  const conversationIds: string[] = [];

  /** A direct chat between me and a friend, last active `minutesAgo`. */
  async function directChat(
    friend: string,
    minutesAgo: number,
    pinned = false,
  ) {
    const conversation = await db.chatConversation.create({
      data: {
        id: id(`dm-${friend}`),
        type: 'DIRECT',
        participants: {
          create: [
            { userId: me, pinnedAt: pinned ? new Date() : null },
            { userId: friend },
          ],
        },
      },
    });
    conversationIds.push(conversation.id);
    await db.$executeRaw`UPDATE chat_conversations SET "updatedAt" = now() - ${minutesAgo} * interval '1 minute' WHERE id = ${conversation.id}`;
    return conversation.id;
  }

  /** Sends through the same repository write the send path uses, receipts included. */
  function send(
    conversationId: string,
    senderId: string,
    recipients: string[],
  ) {
    return db.$transaction((tx) =>
      chats.createMessage(tx, {
        conversationId,
        senderId,
        participantUserIds: [senderId, ...recipients],
        ciphertext: 'opaque',
      }),
    );
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PrismaService,
        ChatRepository,
        ChatAccessService,
        ChatInboxService,
        BlocksRepository,
        BlocksService,
        { provide: MlsGroupRosterRepository, useValue: {} },
        { provide: FollowsService, useValue: {} },
        { provide: GameModeratorsService, useValue: {} },
        { provide: ChatMembershipService, useValue: {} },
        { provide: CHAT_DELIVERY_PORT, useValue: {} },
        // Paging through every page here would trip the 3-pages-per-10-s product limit.
        {
          provide: ChatHistoryFetchRateLimiterService,
          useValue: { assertNotRateLimited: () => undefined },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    db = app.get(PrismaService);
    chats = app.get(ChatRepository);
    inbox = app.get(ChatInboxService);

    await db.user.createMany({
      data: users.map((userId) => ({
        id: userId,
        name: userId,
        email: `${userId}@example.invalid`,
      })),
    });
  });

  afterAll(async () => {
    if (db) {
      await db.chatConversation.deleteMany({
        where: { id: { in: conversationIds } },
      });
      await db.user.deleteMany({ where: { id: { in: users } } });
    }
    await app?.close();
  });

  it('writes a receipt per recipient, so the message is unread for them and read for the sender', async () => {
    const conversationId = await directChat(friends[0], 0);

    const message = await send(conversationId, friends[0], [me]);

    const [mine] = await chats.countUnreadMessagesForConversations(
      [conversationId],
      me,
    );
    expect(mine?._count._all).toBe(1);
    await expect(
      chats.countUnreadMessagesForConversations([conversationId], friends[0]),
    ).resolves.toEqual([]);
    expect(message.receipts.map((receipt) => receipt.userId).sort()).toEqual(
      [me, friends[0]].sort(),
    );
  });

  it('pages history back to the start, every message once and in order, deleted ones as tombstones', async () => {
    const conversationId = await directChat(friends[1], 1);
    const sent: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      const sender = i % 2 ? me : friends[1];
      sent.push(
        (await send(conversationId, sender, [sender === me ? friends[1] : me]))
          .id,
      );
    }
    await chats.softDeleteMessage(sent[3]);

    const seen: Array<{ id: string; status: string }> = [];
    let before: string | undefined;
    do {
      const page = await inbox.findMessages(me, conversationId, {
        limit: 3,
        beforeMessageId: before,
      });
      seen.unshift(...page.items);
      before = page.meta.nextBeforeMessageId ?? undefined;
    } while (before);

    expect(seen.map((message) => message.id)).toEqual(sent);
    expect(seen[3]).toMatchObject({ status: 'DELETED' });
  });

  it('pages the inbox: every chat once, pinned ones only on the first page, newest first', async () => {
    const pinned = await directChat(friends[2], 100, true);
    const rest = [
      await directChat(friends[3], 2),
      await directChat(friends[4], 3),
      await directChat(friends[5], 4),
      await directChat(friends[6], 5),
    ];

    const first = await inbox.listConversations(me, { limit: 2 });
    const pages = [first];
    let last = first.filter((conversation) => !conversation.pinnedAt).at(-1);
    while (last) {
      const page = await inbox.listConversations(me, {
        limit: 2,
        beforeUpdatedAt: new Date(last.updatedAt).toISOString(),
        beforeId: last.id,
      });
      pages.push(page);
      last = page.length === 2 ? page.at(-1) : undefined;
    }

    const all = pages.flat().map((conversation) => conversation.id);
    expect(first[0]?.id).toBe(pinned);
    expect(
      pages
        .slice(1)
        .flat()
        .some((conversation) => conversation.id === pinned),
    ).toBe(false);
    expect(new Set(all).size).toBe(all.length);
    // The chats from the earlier tests are newer than these, so they come first among the unpinned.
    const unpinnedOrder = all.filter(
      (conversationId) => conversationId !== pinned,
    );
    expect(
      unpinnedOrder.filter((conversationId) => rest.includes(conversationId)),
    ).toEqual(rest);
    expect(new Set(all)).toEqual(new Set(conversationIds));
  });
});
