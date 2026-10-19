jest.mock('@thallesp/nestjs-better-auth', () => {
  const common =
    jest.requireActual<typeof import('@nestjs/common')>('@nestjs/common');
  return {
    OptionalAuth: () => common.SetMetadata('OPTIONAL', true),
    Session: () =>
      common.createParamDecorator(
        (_data: unknown, context: import('@nestjs/common').ExecutionContext) =>
          context.switchToHttp().getRequest().session,
      )(),
  };
});
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { BlocksRepository } from '../src/blocks/blocks.repository';
import { BlocksService } from '../src/blocks/blocks.service';
import { CommunityChatController } from '../src/community-chat/community-chat.controller';
import { CommunityChatRateLimiterService } from '../src/community-chat/community-chat-rate-limiter.service';
import { CommunityChatRepository } from '../src/community-chat/community-chat.repository';
import { CommunityAccessService } from '../src/community-chat/community-access.service';
import { CommunityRealtimeService } from '../src/community-chat/community-realtime.service';
import { SocketRegistry } from '../src/websocket/socket-registry.service';
import { CommunityActionsService } from '../src/community-chat/community-actions.service';
import { CommunityChannelsService } from '../src/community-chat/community-channels.service';
import { CommunityMessagePresenter } from '../src/community-chat/community-message.presenter';
import { CommunityMessagingService } from '../src/community-chat/community-messaging.service';
import { GameModeratorsRepository } from '../src/game-moderators/game-moderators.repository';
import { PrismaService } from '../src/prisma/prisma.service';

// Real HTTP controller, validation, services and PostgreSQL persistence, including the
// migration's own check constraints. Session injection is test-only. The rate limiter is
// replaced by a pass-through so one fixture user can post quickly; it has its own unit spec.
// Only this suite's uniquely named fixtures are created and removed.
describe('Community chat API (real database)', () => {
  jest.setTimeout(90_000);
  let app: INestApplication;
  let db: PrismaService;
  const token = randomUUID();
  const id = (name: string) => `cc-${name}-${token}`;
  const ann = id('ann');
  const bo = id('bo');
  const outsider = id('outsider');
  const mod = id('mod');
  const admin = id('admin');
  const suspended = id('suspended');
  const users = [ann, bo, outsider, mod, admin, suspended];
  const slug = `cc-${token}`;
  const otherSlug = `cc-other-${token}`;
  let gameId: string;
  let otherGameId: string;
  let channelId: string;
  let globalEmoteId: string;
  let gameEmoteId: string;
  let foreignEmoteId: string;
  const BASE = `/games/${slug}/chat`;
  const ZWSP = String.fromCodePoint(0x200b);

  const as = (user: string) => ({ 'x-test-user': user });
  const get = (user: string, path: string) =>
    request(app.getHttpServer()).get(path).set(as(user));
  const post = (user: string, path: string, body: object = {}) =>
    request(app.getHttpServer()).post(path).set(as(user)).send(body);
  const send = (user: string, content: string, extra: object = {}) =>
    post(user, `${BASE}/channels/${channelId}/messages`, { content, ...extra });
  const messages = async (user: string, query = '') =>
    (
      await get(user, `${BASE}/channels/${channelId}/messages${query}`).expect(
        200,
      )
    ).body;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CommunityChatController],
      providers: [
        PrismaService,
        CommunityAccessService,
        CommunityMessagePresenter,
        CommunityChannelsService,
        CommunityMessagingService,
        CommunityActionsService,
        CommunityRealtimeService,
        SocketRegistry,
        CommunityChatRepository,
        GameModeratorsRepository,
        BlocksService,
        BlocksRepository,
        {
          provide: CommunityChatRateLimiterService,
          useValue: { assertNotRateLimited: () => {} },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: unknown, next: () => void) => {
      const userId = req.headers['x-test-user'] ?? ann;
      req.user = { id: userId };
      req.session = { user: { id: userId } };
      next();
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
    db = app.get(PrismaService);

    await db.user.createMany({
      data: [
        ...[ann, bo, outsider, mod, suspended].map((userId) => ({
          id: userId,
          name: `User ${userId.slice(3, 8)}`,
          email: `${userId}@example.invalid`,
        })),
        {
          id: admin,
          name: 'Admin',
          email: `${admin}@example.invalid`,
          role: 'ADMIN' as const,
        },
      ],
    });
    await db.user.update({
      where: { id: suspended },
      data: { status: 'SUSPENDED' },
    });
    gameId = (await db.game.create({ data: { name: 'Chat fixture', slug } }))
      .id;
    otherGameId = (
      await db.game.create({ data: { name: 'Other fixture', slug: otherSlug } })
    ).id;
    await db.gameMember.createMany({
      data: [ann, bo, suspended].map((userId) => ({ gameId, userId })),
    });
    await db.gameModerator.create({ data: { gameId, userId: mod } });
    globalEmoteId = (
      await db.chatEmote.create({
        data: {
          scope: 'GLOBAL',
          shortcode: `g${token.slice(0, 8)}`,
          imageUrl: 'https://res.cloudinary.com/x/g.png',
        },
      })
    ).id;
    gameEmoteId = (
      await db.chatEmote.create({
        data: {
          scope: 'GAME',
          gameId,
          shortcode: 'mine',
          imageUrl: 'https://res.cloudinary.com/x/m.png',
        },
      })
    ).id;
    foreignEmoteId = (
      await db.chatEmote.create({
        data: {
          scope: 'GAME',
          gameId: otherGameId,
          shortcode: 'theirs',
          imageUrl: 'https://res.cloudinary.com/x/t.png',
        },
      })
    ).id;
  });

  afterAll(async () => {
    if (db) {
      await db.chatEmote.deleteMany({ where: { id: globalEmoteId } });
      await db.game.deleteMany({
        where: {
          slug: { startsWith: `cc-` },
          id: { in: [gameId, otherGameId] },
        },
      });
      await db.user.deleteMany({
        where: { id: { in: [...users, id('ghost')] } },
      });
    }
    await app?.close();
  });

  describe('who gets in', () => {
    it('refuses someone who has not joined', async () => {
      await get(outsider, BASE).expect(403);
    });

    it('lets in a member, a moderator who has not joined, and an admin who has not', async () => {
      await get(ann, BASE).expect(200);
      const asMod = await get(mod, BASE).expect(200);
      expect(asMod.body).toMatchObject({ canModerate: true, isMember: false });
      await get(admin, BASE).expect(200);
    });

    it('refuses a suspended member', async () => {
      await get(suspended, BASE).expect(403);
    });

    it('does not find an unknown community', async () => {
      await get(ann, `/games/nope-${token}/chat`).expect(404);
    });

    it('does not find an archived community', async () => {
      await db.game.update({
        where: { id: otherGameId },
        data: { status: 'ARCHIVED' },
      });
      await db.gameMember.create({
        data: { gameId: otherGameId, userId: ann },
      });
      await get(ann, `/games/${otherSlug}/chat`).expect(404);
    });
  });

  describe('the default room', () => {
    it('is created the first time anyone opens the chat, and only once', async () => {
      const first = await get(ann, BASE).expect(200);
      const second = await get(bo, BASE).expect(200);

      channelId = first.body.channels[0].id;
      expect(first.body.channels).toHaveLength(1);
      expect(first.body.channels[0]).toMatchObject({
        slug: 'general',
        name: 'general',
        unreadCount: 0,
      });
      expect(second.body.channels[0].id).toBe(channelId);
      expect(await db.gameChannel.count({ where: { gameId } })).toBe(1);
    });

    it('is created once even when many people open it at the same moment', async () => {
      const racing = await db.game.create({
        data: { name: 'Race', slug: `cc-race-${token}` },
      });
      await db.gameMember.createMany({
        data: [ann, bo].map((userId) => ({ gameId: racing.id, userId })),
      });

      const responses = await Promise.all(
        [ann, bo, ann, bo].map((user) =>
          get(user, `/games/${racing.slug}/chat`),
        ),
      );

      expect(responses.map((response) => response.status)).toEqual([
        200, 200, 200, 200,
      ]);

      expect(await db.gameChannel.count({ where: { gameId: racing.id } })).toBe(
        1,
      );
      await db.game.delete({ where: { id: racing.id } });
    });
  });

  describe('messages', () => {
    it('stores a cleaned message and returns it with its author', async () => {
      const response = await send(ann, `  hello${ZWSP} world  `).expect(201);

      expect(response.body).toMatchObject({
        content: 'hello world',
        deleted: false,
        blocked: false,
        author: { id: ann, badge: null },
      });
      const row = await db.gameChannelMessage.findUniqueOrThrow({
        where: { id: response.body.id },
      });
      expect(row.content).toBe('hello world');
    });

    it('lists history oldest first and pages back with before', async () => {
      for (const text of ['one', 'two', 'three', 'four'])
        await send(bo, text).expect(201);

      const newest = await messages(ann, '?limit=3');
      expect(newest.items).toHaveLength(3);
      expect(
        newest.items.map((item: { content: string }) => item.content),
      ).toEqual(['two', 'three', 'four']);
      expect(newest.hasMore).toBe(true);

      const older = await messages(
        ann,
        `?limit=3&before=${newest.items[0].id}`,
      );
      expect(
        older.items.map((item: { content: string }) => item.content),
      ).toEqual(['hello world', 'one']);
      expect(older.hasMore).toBe(false);
    });

    it('refuses an unknown message to page before', async () => {
      await get(
        ann,
        `${BASE}/channels/${channelId}/messages?before=nope`,
      ).expect(400);
    });

    it('posts a retried send once', async () => {
      const clientMessageId = randomUUID();
      const a = await send(ann, 'once', { clientMessageId }).expect(201);
      const b = await send(ann, 'once', { clientMessageId }).expect(201);

      expect(b.body.id).toBe(a.body.id);
      expect(
        await db.gameChannelMessage.count({
          where: { authorId: ann, clientMessageId },
        }),
      ).toBe(1);
    });

    it('posts a double send at the same moment once', async () => {
      const clientMessageId = randomUUID();

      const [a, b] = await Promise.all([
        send(ann, 'race', { clientMessageId }),
        send(ann, 'race', { clientMessageId }),
      ]);

      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body.id).toBe(b.body.id);
      expect(
        await db.gameChannelMessage.count({
          where: { authorId: ann, clientMessageId },
        }),
      ).toBe(1);
    });

    it('refuses empty, hidden-only and over-long messages', async () => {
      await send(ann, '   ').expect(400);
      await send(ann, `${ZWSP}${ZWSP}`).expect(400);
      await send(ann, 'x'.repeat(2001)).expect(400);
      await send(ann, 'x'.repeat(2000)).expect(201);
    });

    it('refuses someone outside the community', async () => {
      await send(outsider, 'hi').expect(403);
    });

    it('answers a message, and quotes it', async () => {
      const target = await send(bo, 'a question').expect(201);

      const reply = await send(ann, 'an answer', {
        replyToId: target.body.id,
      }).expect(201);

      expect(reply.body.replyTo).toMatchObject({
        id: target.body.id,
        content: 'a question',
        deleted: false,
      });
    });

    it('refuses a reply to a message in another room', async () => {
      const second = await db.gameChannel.create({
        data: { gameId, slug: 'other', name: 'other' },
      });
      const elsewhere = await db.gameChannelMessage.create({
        data: { channelId: second.id, authorId: bo, content: 'elsewhere' },
      });

      await send(ann, 'wrong room', { replyToId: elsewhere.id }).expect(400);
      await db.gameChannel.delete({ where: { id: second.id } });
    });
  });

  describe('one message', () => {
    const one = (user: string, messageId: string) =>
      get(user, `${BASE}/messages/${messageId}`);

    it('returns a single message, and shows a removed one as removed', async () => {
      const created = await send(ann, 'just this one').expect(201);

      const found = await one(bo, created.body.id).expect(200);
      expect(found.body).toMatchObject({
        id: created.body.id,
        content: 'just this one',
        deleted: false,
      });

      await request(app.getHttpServer())
        .delete(`${BASE}/messages/${created.body.id}`)
        .set(as(ann))
        .send({})
        .expect(200);
      const gone = await one(bo, created.body.id).expect(200);
      expect(gone.body).toMatchObject({ deleted: true, content: null });
    });

    it('refuses someone who is not in the community, and an unknown message', async () => {
      const created = await send(ann, 'members only').expect(201);

      await one(outsider, created.body.id).expect(403);
      await one(ann, randomUUID()).expect(404);
    });
  });

  describe('editing and removing', () => {
    it('lets the author edit, and marks it edited', async () => {
      const created = await send(ann, 'typo').expect(201);

      const edited = await request(app.getHttpServer())
        .patch(`${BASE}/messages/${created.body.id}`)
        .set(as(ann))
        .send({ content: 'fixed' })
        .expect(200);

      expect(edited.body).toMatchObject({ content: 'fixed' });
      expect(edited.body.editedAt).not.toBeNull();
    });

    it("refuses to edit someone else's message, even for a moderator", async () => {
      const created = await send(ann, 'mine').expect(201);

      await request(app.getHttpServer())
        .patch(`${BASE}/messages/${created.body.id}`)
        .set(as(mod))
        .send({ content: 'hijack' })
        .expect(403);
    });

    it('refuses an edit after 15 minutes', async () => {
      const created = await send(ann, 'old').expect(201);
      await db.gameChannelMessage.update({
        where: { id: created.body.id },
        data: { createdAt: new Date(Date.now() - 16 * 60 * 1000) },
      });

      await request(app.getHttpServer())
        .patch(`${BASE}/messages/${created.body.id}`)
        .set(as(ann))
        .send({ content: 'too late' })
        .expect(400);
    });

    it('removes your own message: gone from the API, kept in the database', async () => {
      const created = await send(ann, 'secret plans').expect(201);

      const removed = await request(app.getHttpServer())
        .delete(`${BASE}/messages/${created.body.id}`)
        .set(as(ann))
        .send({})
        .expect(200);

      expect(removed.body).toMatchObject({ deleted: true, content: null });
      const page = await messages(bo, '?limit=100');
      expect(JSON.stringify(page)).not.toContain('secret plans');
      const row = await db.gameChannelMessage.findUniqueOrThrow({
        where: { id: created.body.id },
      });
      expect(row).toMatchObject({
        content: 'secret plans',
        deletedById: ann,
        deleteReason: null,
      });
      expect(row.deletedAt).not.toBeNull();
    });

    it("lets a moderator remove anyone's message and records why", async () => {
      const created = await send(ann, 'rude words').expect(201);

      await request(app.getHttpServer())
        .delete(`${BASE}/messages/${created.body.id}`)
        .set(as(mod))
        .send({ reason: '  harassment  ' })
        .expect(200);

      const row = await db.gameChannelMessage.findUniqueOrThrow({
        where: { id: created.body.id },
      });
      expect(row).toMatchObject({
        deletedById: mod,
        deleteReason: 'harassment',
      });
    });

    it("refuses a member removing someone else's message", async () => {
      const created = await send(ann, 'stay').expect(201);

      await request(app.getHttpServer())
        .delete(`${BASE}/messages/${created.body.id}`)
        .set(as(bo))
        .send({})
        .expect(403);
    });

    it('badges a moderator and an admin on what they post', async () => {
      const fromMod = await send(mod, 'official').expect(201);
      const fromAdmin = await send(admin, 'also official').expect(201);

      expect(fromMod.body.author.badge).toBe('MODERATOR');
      expect(fromAdmin.body.author.badge).toBe('ADMIN');
    });
  });

  describe('reactions', () => {
    let messageId: string;
    const react = (user: string, body: object) =>
      post(user, `${BASE}/messages/${messageId}/reactions`, body);

    beforeAll(async () => {
      messageId = (await send(ann, 'react to me')).body.id;
    });

    it('keeps one reaction per person, replacing the last', async () => {
      await react(bo, { emoji: '👍' }).expect(201);
      const second = await react(bo, { emoji: '❤️' }).expect(201);

      expect(
        second.body.reactions.filter(
          (item: { userId: string }) => item.userId === bo,
        ),
      ).toEqual([expect.objectContaining({ emoji: '❤️' })]);
      expect(
        await db.gameChannelReaction.count({
          where: { messageId, userId: bo },
        }),
      ).toBe(1);
    });

    it("accepts a global emote and one of this community, and refuses another community's", async () => {
      await react(bo, { emoteId: globalEmoteId }).expect(201);
      const own = await react(bo, { emoteId: gameEmoteId }).expect(201);
      await react(bo, { emoteId: foreignEmoteId }).expect(403);

      expect(
        own.body.reactions.find(
          (item: { userId: string }) => item.userId === bo,
        ).emote,
      ).toMatchObject({ shortcode: 'mine' });
    });

    it('refuses something that is not one emoji', async () => {
      await react(bo, { emoji: 'hello' }).expect(400);
      await react(bo, {}).expect(400);
    });

    it('takes a reaction back', async () => {
      const response = await request(app.getHttpServer())
        .delete(`${BASE}/messages/${messageId}/reactions`)
        .set(as(bo))
        .expect(200);

      expect(
        response.body.reactions.filter(
          (item: { userId: string }) => item.userId === bo,
        ),
      ).toEqual([]);
    });

    it('refuses to react to a removed message', async () => {
      const gone = (await send(ann, 'to be removed')).body.id;
      await request(app.getHttpServer())
        .delete(`${BASE}/messages/${gone}`)
        .set(as(ann))
        .send({})
        .expect(200);

      await post(bo, `${BASE}/messages/${gone}/reactions`, {
        emoji: '👍',
      }).expect(400);
    });
  });

  describe('unread counts', () => {
    it('counts messages from other people since you last read, and clears on read', async () => {
      const reader = await db.user.create({
        data: {
          id: id('reader'),
          name: 'Reader',
          email: `${id('reader')}@example.invalid`,
        },
      });
      users.push(reader.id);
      await db.gameMember.create({ data: { gameId, userId: reader.id } });
      const before = await get(reader.id, BASE).expect(200);
      expect(before.body.channels[0].unreadCount).toBe(0);

      const first = await send(ann, 'unread one').expect(201);
      const second = await send(ann, 'unread two').expect(201);
      await send(reader.id, 'my own').expect(201);

      const counted = await get(reader.id, BASE).expect(200);
      expect(counted.body.channels[0].unreadCount).toBe(2);

      await post(reader.id, `${BASE}/channels/${channelId}/read`, {
        messageId: first.body.id,
      }).expect(201);
      expect((await get(reader.id, BASE)).body.channels[0].unreadCount).toBe(1);

      await post(reader.id, `${BASE}/channels/${channelId}/read`, {
        messageId: second.body.id,
      }).expect(201);
      expect((await get(reader.id, BASE)).body.channels[0].unreadCount).toBe(0);
    });

    it('never moves the read position backwards', async () => {
      const readerId = id('reader');
      const state = () =>
        db.gameChannelReadState.findUniqueOrThrow({
          where: { userId_channelId: { userId: readerId, channelId } },
        });
      const before = await state();
      const old = await db.gameChannelMessage.findFirstOrThrow({
        where: { channelId },
        orderBy: { createdAt: 'asc' },
      });

      await post(readerId, `${BASE}/channels/${channelId}/read`, {
        messageId: old.id,
      }).expect(201);

      expect((await state()).lastReadAt.getTime()).toBe(
        before.lastReadAt.getTime(),
      );
    });

    it('refuses to mark read up to a message that is not in the room', async () => {
      await post(ann, `${BASE}/channels/${channelId}/read`, {
        messageId: 'nope',
      }).expect(400);
    });
  });

  describe('blocking', () => {
    it("hides a blocked person's messages from the person who blocked them, and only from them", async () => {
      const unfriendly = await send(bo, 'unfriendly words').expect(201);
      await db.chatUserBlock.create({
        data: { blockerId: ann, blockedId: bo },
      });

      const forAnn = await messages(ann, '?limit=100');
      const forMod = await messages(mod, '?limit=100');

      const hidden = forAnn.items.find(
        (item: { id: string }) => item.id === unfriendly.body.id,
      );
      expect(hidden).toMatchObject({
        blocked: true,
        content: null,
        author: null,
        reactions: [],
      });
      expect(JSON.stringify(forAnn)).not.toContain('unfriendly words');
      expect(
        forMod.items.find(
          (item: { id: string }) => item.id === unfriendly.body.id,
        ),
      ).toMatchObject({ blocked: false, content: 'unfriendly words' });
      // the block does not run the other way: bo still sees ann
      const forBo = await messages(bo, '?limit=100');
      expect(
        forBo.items.filter((item: { blocked: boolean }) => item.blocked),
      ).toEqual([]);
    });

    it('hides the quote of a blocked person in a reply, but the reply itself shows', async () => {
      const target = (await send(bo, 'quoted words')).body.id;
      const reply = (await send(mod, 'replying to bo', { replyToId: target }))
        .body.id;

      const forAnn = await messages(ann, '?limit=100');
      const shown = forAnn.items.find(
        (item: { id: string }) => item.id === reply,
      );

      expect(shown).toMatchObject({
        blocked: false,
        content: 'replying to bo',
      });
      expect(shown.replyTo).toMatchObject({ blocked: true, content: null });
    });

    it('still lets the blocked person post', async () => {
      await send(bo, 'still here').expect(201);
    });

    it('brings the messages back after an unblock', async () => {
      await db.chatUserBlock.deleteMany({
        where: { blockerId: ann, blockedId: bo },
      });

      const page = await messages(ann, '?limit=100');

      expect(
        page.items.filter((item: { blocked: boolean }) => item.blocked),
      ).toEqual([]);
    });
  });

  describe('room rules', () => {
    afterEach(async () => {
      await db.gameChannel.update({
        where: { id: channelId },
        data: { isLocked: false, slowmodeSeconds: 0, kind: 'TEXT' },
      });
    });

    it('lets only moderators post in a locked room', async () => {
      await db.gameChannel.update({
        where: { id: channelId },
        data: { isLocked: true },
      });

      await send(ann, 'locked out').expect(403);
      await send(mod, 'moderator may').expect(201);
    });

    it('lets only moderators post announcements', async () => {
      await db.gameChannel.update({
        where: { id: channelId },
        data: { kind: 'ANNOUNCEMENT' },
      });

      await send(ann, 'no').expect(403);
      await send(admin, 'yes').expect(201);
    });

    it('makes members wait out slow mode but not moderators', async () => {
      await db.gameChannel.update({
        where: { id: channelId },
        data: { slowmodeSeconds: 60 },
      });

      await send(bo, 'a').expect(429);
      await send(mod, 'b').expect(201);
      await send(mod, 'c').expect(201);
    });
  });

  describe('data kept by the migration', () => {
    it('keeps messages of an account that is gone, without an author', async () => {
      const ghost = id('ghost');
      await db.user.create({
        data: { id: ghost, name: 'Ghost', email: `${ghost}@example.invalid` },
      });
      await db.gameMember.create({ data: { gameId, userId: ghost } });
      const said = await send(ghost, 'goodbye').expect(201);

      await db.user.delete({ where: { id: ghost } });

      const page = await messages(ann, '?limit=100');
      expect(
        page.items.find((item: { id: string }) => item.id === said.body.id),
      ).toMatchObject({ author: null, content: 'goodbye' });
    });

    it('refuses a second room with the same slug in one community', async () => {
      await expect(
        db.gameChannel.create({
          data: { gameId, slug: 'general', name: 'again' },
        }),
      ).rejects.toThrow();
    });

    it('enforces the message length check even for a write that skips the API', async () => {
      await expect(
        db.gameChannelMessage.create({
          data: { channelId, authorId: ann, content: '' },
        }),
      ).rejects.toThrow();
      await expect(
        db.gameChannelMessage.create({
          data: { channelId, authorId: ann, content: 'x'.repeat(2001) },
        }),
      ).rejects.toThrow();
    });

    it('enforces that a reaction is an emoji or an emote, never both and never neither', async () => {
      const target = await db.gameChannelMessage.create({
        data: { channelId, authorId: ann, content: 'for checks' },
      });

      await expect(
        db.gameChannelReaction.create({
          data: { messageId: target.id, userId: bo },
        }),
      ).rejects.toThrow();
      await expect(
        db.gameChannelReaction.create({
          data: {
            messageId: target.id,
            userId: bo,
            emoji: '👍',
            emoteId: globalEmoteId,
          },
        }),
      ).rejects.toThrow();
      await expect(
        db.gameChannelReaction.create({
          data: { messageId: target.id, userId: bo, emoji: '👍' },
        }),
      ).resolves.toBeDefined();
    });

    it('removes a reaction together with a hard-deleted emote', async () => {
      const target = await db.gameChannelMessage.create({
        data: { channelId, authorId: ann, content: 'emote cascade' },
      });
      await db.gameChannelReaction.create({
        data: { messageId: target.id, userId: ann, emoteId: gameEmoteId },
      });

      await db.chatEmote.delete({ where: { id: gameEmoteId } });

      expect(
        await db.gameChannelReaction.count({ where: { messageId: target.id } }),
      ).toBe(0);
    });

    it('removes a community together with its rooms, messages, reactions and read positions', async () => {
      const doomed = await db.game.create({
        data: { name: 'Doomed', slug: `cc-doomed-${token}` },
      });
      const room = await db.gameChannel.create({
        data: { gameId: doomed.id, slug: 'general', name: 'general' },
      });
      const note = await db.gameChannelMessage.create({
        data: { channelId: room.id, authorId: ann, content: 'bye' },
      });
      await db.gameChannelReaction.create({
        data: { messageId: note.id, userId: ann, emoji: '👍' },
      });
      await db.gameChannelReadState.create({
        data: { userId: ann, channelId: room.id, lastReadAt: new Date() },
      });

      await db.game.delete({ where: { id: doomed.id } });

      expect(await db.gameChannel.count({ where: { id: room.id } })).toBe(0);
      expect(
        await db.gameChannelMessage.count({ where: { id: note.id } }),
      ).toBe(0);
      expect(
        await db.gameChannelReaction.count({ where: { messageId: note.id } }),
      ).toBe(0);
      expect(
        await db.gameChannelReadState.count({ where: { channelId: room.id } }),
      ).toBe(0);
    });
  });

  describe('two requests at once', () => {
    const roomWith = async (slug: string, slowmodeSeconds = 0) =>
      db.gameChannel.create({
        data: { gameId, slug, name: slug, slowmodeSeconds },
      });

    it('lets only one of two simultaneous messages through slow mode, the other gets 429', async () => {
      for (let round = 0; round < 5; round += 1) {
        const room = await roomWith(`race-slow-${round}`, 60);
        // Their last message is long enough ago, so slow mode would allow exactly one more.
        await db.gameChannelMessage.create({
          data: {
            channelId: room.id,
            authorId: ann,
            content: 'old',
            createdAt: new Date(Date.now() - 120_000),
          },
        });

        const results = await Promise.all(
          ['one', 'two'].map((content) =>
            post(ann, `${BASE}/channels/${room.id}/messages`, { content }),
          ),
        );

        expect(results.map((result) => result.status).sort()).toEqual([
          201, 429,
        ]);
        expect(
          await db.gameChannelMessage.count({
            where: {
              channelId: room.id,
              authorId: ann,
              content: { not: 'old' },
            },
          }),
        ).toBe(1);
      }
    });

    it('does not make a different member wait because of someone else sending', async () => {
      const room = await roomWith('race-slow-others', 60);

      const results = await Promise.all(
        [ann, bo].map((user) =>
          post(user, `${BASE}/channels/${room.id}/messages`, { content: 'hi' }),
        ),
      );

      expect(results.map((result) => result.status)).toEqual([201, 201]);
    });

    it('never moves the read position back when an older mark lands after a newer one', async () => {
      const repository = app.get(CommunityChatRepository);
      const room = await roomWith('race-read');
      const older = await db.gameChannelMessage.create({
        data: {
          channelId: room.id,
          authorId: ann,
          content: 'older',
          createdAt: new Date(Date.now() - 60_000),
        },
      });
      const newer = await db.gameChannelMessage.create({
        data: {
          channelId: room.id,
          authorId: ann,
          content: 'newer',
          createdAt: new Date(Date.now() - 10_000),
        },
      });
      const mark = (message: { id: string; createdAt: Date }) =>
        repository.markRead({
          userId: bo,
          channelId: room.id,
          at: message.createdAt,
          messageId: message.id,
        });
      const position = async () =>
        db.gameChannelReadState.findUniqueOrThrow({
          where: { userId_channelId: { userId: bo, channelId: room.id } },
        });

      // The older one finishing last, which is what two tabs can do.
      await mark(newer);
      await mark(older);
      expect((await position()).lastReadAt).toEqual(newer.createdAt);
      expect((await position()).lastReadMessageId).toBe(newer.id);

      // Many overlapping marks in any order end at the newest.
      for (let round = 0; round < 20; round += 1) {
        await Promise.all(
          [older, newer, older, newer, older].map((message) => mark(message)),
        );
        expect((await position()).lastReadAt).toEqual(newer.createdAt);
      }
    });

    it('moves the position forward, and creates it the first time', async () => {
      const repository = app.get(CommunityChatRepository);
      const room = await roomWith('race-read-forward');
      const first = new Date(Date.now() - 60_000);
      const second = new Date(Date.now() - 30_000);
      const read = () =>
        db.gameChannelReadState.findUnique({
          where: { userId_channelId: { userId: ann, channelId: room.id } },
        });

      await repository.markRead({ userId: ann, channelId: room.id, at: first });
      expect((await read())?.lastReadAt).toEqual(first);

      await repository.markRead({
        userId: ann,
        channelId: room.id,
        at: second,
      });
      expect((await read())?.lastReadAt).toEqual(second);
    });
  });
});
