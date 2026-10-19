import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { RateLimitedException } from '../common/exceptions/rate-limited.exception';
import { channel, row, scope } from './community-chat.fixtures';
import { CommunityMessagingService } from './community-messaging.service';

const ZWSP = String.fromCodePoint(0x200b);

describe('CommunityMessagingService', () => {
  const repository = {
    findCursor: jest.fn(),
    listMessages: jest.fn(),
    findByClientMessageId: jest.fn(),
    findMessageInChannel: jest.fn(),
    createMessage: jest.fn(),
  };
  const access = { scope: jest.fn(), channelIn: jest.fn() };
  const rateLimiter = { assertNotRateLimited: jest.fn() };
  const presenter = { page: jest.fn(), one: jest.fn() };
  const realtime = { changed: jest.fn() };

  let service: CommunityMessagingService;

  beforeEach(() => {
    jest.resetAllMocks();
    access.scope.mockResolvedValue(scope());
    access.channelIn.mockResolvedValue(channel);
    repository.findByClientMessageId.mockResolvedValue(null);
    repository.findMessageInChannel.mockResolvedValue({ id: 'm0' });
    repository.createMessage.mockImplementation(
      (data: { content: string; channelId: string }) =>
        Promise.resolve({
          created: row({ content: data.content, channelId: data.channelId }),
        }),
    );
    // The presenter is covered by its own spec; here it just echoes what it was given.
    presenter.page.mockImplementation(
      (_game: string, _viewer: string, rows: unknown[]) =>
        Promise.resolve(rows),
    );
    presenter.one.mockImplementation((_scope: unknown, message: unknown) =>
      Promise.resolve(message),
    );
    service = new CommunityMessagingService(
      repository as never,
      access as never,
      rateLimiter as never,
      presenter as never,
      realtime as never,
    );
  });

  describe('listMessages', () => {
    const query = (extra = {}) => ({ limit: 2, ...extra }) as never;
    const ids = (items: unknown[]) =>
      items.map((item) => (item as { id: string }).id);

    it('returns the page oldest first, and says when older ones remain', async () => {
      repository.listMessages.mockResolvedValue([
        row({ id: 'm3' }),
        row({ id: 'm2' }),
        row({ id: 'm1' }),
      ]);

      const result = await service.listMessages('wuwa', 'c1', query(), 'me');

      expect(ids(result.items)).toEqual(['m2', 'm3']);
      expect(result.hasMore).toBe(true);
    });

    it('says there is nothing older on the last page', async () => {
      repository.listMessages.mockResolvedValue([
        row({ id: 'm2' }),
        row({ id: 'm1' }),
      ]);

      expect(
        (await service.listMessages('wuwa', 'c1', query(), 'me')).hasMore,
      ).toBe(false);
    });

    it('hands the page to the presenter for the viewer', async () => {
      repository.listMessages.mockResolvedValue([row({ id: 'm1' })]);

      await service.listMessages('wuwa', 'c1', query(), 'me');

      expect(presenter.page).toHaveBeenCalledWith('g1', 'me', [
        expect.objectContaining({ id: 'm1' }),
      ]);
    });

    it('loads the page before a message', async () => {
      const cursor = { id: 'm5', createdAt: new Date('2026-10-16T00:00:00Z') };
      repository.findCursor.mockResolvedValue(cursor);
      repository.listMessages.mockResolvedValue([]);

      await service.listMessages('wuwa', 'c1', query({ before: 'm5' }), 'me');

      expect(repository.listMessages).toHaveBeenCalledWith({
        channelId: 'c1',
        before: cursor,
        limit: 2,
      });
    });

    it('refuses a message to load before that is not in this room', async () => {
      repository.findCursor.mockResolvedValue(null);

      await expect(
        service.listMessages('wuwa', 'c1', query({ before: 'nope' }), 'me'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('send', () => {
    const send = (dto: Record<string, unknown> = {}, userId = 'me') =>
      service.send('wuwa', 'c1', { content: 'hello', ...dto }, userId);

    it('posts the cleaned text and returns the presented message', async () => {
      const message = await send({ content: `  hi${ZWSP} there  ` });

      expect(repository.createMessage).toHaveBeenCalledWith(
        {
          channelId: 'c1',
          authorId: 'me',
          content: 'hi there',
          replyToId: undefined,
          clientMessageId: undefined,
        },
        0,
      );
      expect(presenter.one).toHaveBeenCalledTimes(1);
      expect(message).toMatchObject({ content: 'hi there', channelId: 'c1' });
    });

    it('tells the room something changed, once a message is saved', async () => {
      await send();

      expect(realtime.changed).toHaveBeenCalledWith('c1');
    });

    it('says nothing for a retry that returns the earlier message, or a message that was refused', async () => {
      repository.findByClientMessageId.mockResolvedValue(row({ id: 'again' }));
      await send({ clientMessageId: 'client-1' });
      repository.findByClientMessageId.mockResolvedValue(null);
      await send({ content: ` ${ZWSP} ` }).catch(() => undefined);

      expect(realtime.changed).not.toHaveBeenCalled();
    });

    it('refuses a message that is empty once cleaned', async () => {
      await expect(send({ content: ` ${ZWSP} ` })).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.createMessage).not.toHaveBeenCalled();
    });

    it('refuses a message over 2000 characters, counting an emoji as one', async () => {
      await expect(send({ content: 'x'.repeat(2001) })).rejects.toThrow(
        /too long/,
      );
      await expect(send({ content: '😀'.repeat(2000) })).resolves.toBeDefined();
    });

    it('hands back the message of a send that already went through, instead of a second one', async () => {
      repository.findByClientMessageId.mockResolvedValue(row({ id: 'again' }));

      const message = await send({ clientMessageId: 'client-1' });

      expect(message).toMatchObject({ id: 'again' });
      expect(repository.createMessage).not.toHaveBeenCalled();
      expect(rateLimiter.assertNotRateLimited).not.toHaveBeenCalled();
    });

    it('refuses a client id that was used in another room', async () => {
      repository.findByClientMessageId.mockResolvedValue(
        row({ channelId: 'other' }),
      );

      await expect(send({ clientMessageId: 'client-1' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('gives the loser of a double send the winning message', async () => {
      repository.createMessage.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['authorId', 'clientMessageId'] },
        }),
      );
      repository.findByClientMessageId
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(row({ id: 'winner' }));

      expect(await send({ clientMessageId: 'client-1' })).toMatchObject({
        id: 'winner',
      });
    });

    it('lets another failure through', async () => {
      repository.createMessage.mockRejectedValue(new Error('db down'));

      await expect(send()).rejects.toThrow('db down');
    });

    it('checks a reply target is in the same room', async () => {
      repository.findMessageInChannel.mockResolvedValue(null);

      await expect(send({ replyToId: 'elsewhere' })).rejects.toThrow(
        /Reply target/,
      );
    });

    it('sends a reply', async () => {
      await send({ replyToId: 'm0' });

      expect(repository.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ replyToId: 'm0' }),
        0,
      );
    });

    describe('limits', () => {
      const asModerator = () =>
        access.scope.mockResolvedValue(scope({ canModerate: true }));

      it('refuses a member in a locked room, but not a moderator', async () => {
        access.channelIn.mockResolvedValue({ ...channel, isLocked: true });

        await expect(send()).rejects.toThrow(/locked/);

        asModerator();
        await expect(send()).resolves.toBeDefined();
      });

      it('keeps announcements to moderators', async () => {
        access.channelIn.mockResolvedValue({
          ...channel,
          kind: 'ANNOUNCEMENT',
        });

        await expect(send()).rejects.toThrow(ForbiddenException);

        asModerator();
        await expect(send()).resolves.toBeDefined();
      });

      it('applies the rate limit to members, and sends nothing when it trips', async () => {
        rateLimiter.assertNotRateLimited.mockImplementation(() => {
          throw new RateLimitedException('slow down', 5);
        });

        await expect(send()).rejects.toThrow(RateLimitedException);
        expect(repository.createMessage).not.toHaveBeenCalled();
      });

      it('does not rate limit a moderator', async () => {
        asModerator();

        await send();

        expect(rateLimiter.assertNotRateLimited).not.toHaveBeenCalled();
      });

      it('makes a member wait out slow mode, the check being part of saving the message', async () => {
        access.channelIn.mockResolvedValue({ ...channel, slowmodeSeconds: 10 });
        repository.createMessage.mockResolvedValue({ waitMs: 6500 });

        const failure = await send().catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(RateLimitedException);
        expect((failure as RateLimitedException).retryAfterSeconds).toBe(7);
        expect(repository.createMessage).toHaveBeenCalledWith(
          expect.anything(),
          10,
        );
        expect(realtime.changed).not.toHaveBeenCalled();
      });

      it('passes the room slow mode to members and none for moderators', async () => {
        access.channelIn.mockResolvedValue({ ...channel, slowmodeSeconds: 60 });

        await send();
        expect(repository.createMessage).toHaveBeenLastCalledWith(
          expect.anything(),
          60,
        );

        asModerator();
        await send();
        expect(repository.createMessage).toHaveBeenLastCalledWith(
          expect.anything(),
          0,
        );
      });
    });
  });
});
