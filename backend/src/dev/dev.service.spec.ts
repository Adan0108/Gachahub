jest.mock('../auth/auth', () => ({
  auth: { api: { signUpEmail: jest.fn(), signInEmail: jest.fn() } },
}));

import { InternalServerErrorException } from '@nestjs/common';
import { env } from '../config/env';
import { DevService } from './dev.service';

/**
 * DevService can mint a session for any user id and mass-delete accounts -
 * its constructor guard against running outside development is the whole
 * defense-in-depth story once DevModule is ever accidentally registered
 * (app.module.ts). Must fail CLOSED: only 'development' is allowed, every
 * other value - including one that's unset, which env.ts now maps to
 * 'production' rather than defaulting to 'development' - is rejected.
 */
describe('DevService', () => {
  const originalNodeEnv = env.nodeEnv;

  afterEach(() => {
    env.nodeEnv = originalNodeEnv;
  });

  it('throws when nodeEnv is production', () => {
    env.nodeEnv = 'production';

    expect(() => new DevService({} as never, {} as never)).toThrow(
      InternalServerErrorException,
    );
  });

  it('throws for an unexpected nodeEnv value such as staging', () => {
    env.nodeEnv = 'staging';

    expect(() => new DevService({} as never, {} as never)).toThrow(
      InternalServerErrorException,
    );
  });

  it('does not throw when nodeEnv is development', () => {
    env.nodeEnv = 'development';

    expect(() => new DevService({} as never, {} as never)).not.toThrow();
  });

  describe('deleting test users', () => {
    const makeService = () => {
      env.nodeEnv = 'development';
      const prisma = {
        user: {
          findUnique: jest.fn().mockResolvedValue({ name: 'DevTest_1' }),
          findMany: jest.fn().mockResolvedValue([{ id: 'u1' }]),
          delete: jest.fn(),
          deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
        },
        session: {
          findMany: jest.fn().mockResolvedValue([
            { id: 's1', token: 't1' },
            { id: 's2', token: 't2' },
          ]),
        },
        chatMessageMedia: { deleteMany: jest.fn() },
        postMedia: { deleteMany: jest.fn() },
      };
      const terminator = { end: jest.fn() };
      return {
        prisma,
        terminator,
        service: new DevService(prisma as never, terminator as never),
      };
    };

    it('ends the logins of a deleted user properly, before removing them', async () => {
      const { service, terminator, prisma } = makeService();

      await service.deleteTestUser('u1');

      expect(prisma.session.findMany).toHaveBeenCalledWith({
        where: { user: { id: 'u1' } },
        select: { id: true, token: true },
      });
      expect(terminator.end).toHaveBeenCalledWith([
        { id: 's1', token: 't1' },
        { id: 's2', token: 't2' },
      ]);
    });

    it('does the same when deleting every test user', async () => {
      const { service, terminator } = makeService();

      await service.deleteAllTestUsers();

      expect(terminator.end).toHaveBeenCalledTimes(1);
    });

    it('drops chat and post media links before the user, so the RESTRICT on mediaUpload never fires', async () => {
      const { service, prisma } = makeService();

      await service.deleteTestUser('u1');

      expect(prisma.chatMessageMedia.deleteMany).toHaveBeenCalledWith({
        where: { mediaUpload: { userId: { in: ['u1'] } } },
      });
      expect(prisma.postMedia.deleteMany).toHaveBeenCalledWith({
        where: { mediaUpload: { userId: { in: ['u1'] } } },
      });
      expect(
        prisma.chatMessageMedia.deleteMany.mock.invocationCallOrder[0],
      ).toBeLessThan(prisma.user.delete.mock.invocationCallOrder[0]);
    });
  });
});

describe('DevService seeding emotes', () => {
  const makeService = (existing: string[]) => {
    env.nodeEnv = 'development';
    const prisma = {
      chatEmote: {
        findFirst: jest.fn(({ where }: { where: { shortcode: string } }) =>
          Promise.resolve(
            existing.includes(where.shortcode) ? { id: 'x' } : null,
          ),
        ),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    return { service: new DevService(prisma as never, {} as never), prisma };
  };

  afterEach(() => {
    env.nodeEnv = 'development';
  });

  it('creates global emotes that are not there yet', async () => {
    const { service, prisma } = makeService([]);

    const result = await service.seedGlobalEmotes();

    expect(result.created).toEqual(['pity', 'lucky', 'salty', 'roll']);
    expect(result.existing).toEqual([]);
    expect(prisma.chatEmote.create).toHaveBeenCalledTimes(4);
  });

  it('can be run again without making duplicates', async () => {
    const { service, prisma } = makeService(['pity', 'lucky', 'salty', 'roll']);

    const result = await service.seedGlobalEmotes();

    expect(result.created).toEqual([]);
    expect(result.existing).toHaveLength(4);
    expect(prisma.chatEmote.create).not.toHaveBeenCalled();
  });

  it('only creates the missing ones when some are there', async () => {
    const { service, prisma } = makeService(['pity']);

    const result = await service.seedGlobalEmotes();

    expect(result.created).toEqual(['lucky', 'salty', 'roll']);
    expect(prisma.chatEmote.create).toHaveBeenCalledTimes(3);
  });

  it('stores global emotes with a picture and a size, and nobody as the author', async () => {
    const { service, prisma } = makeService([]);

    await service.seedGlobalEmotes();

    const [{ data }] = prisma.chatEmote.create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(data).toMatchObject({
      scope: 'GLOBAL',
      shortcode: 'pity',
      width: 64,
      height: 64,
      mimeType: 'image/svg+xml',
    });
    expect(String(data.imageUrl)).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(data).not.toHaveProperty('createdById');
    expect(data).not.toHaveProperty('gameId');
  });

  it('draws a valid picture for each', async () => {
    const { service, prisma } = makeService([]);

    await service.seedGlobalEmotes();

    for (const [{ data }] of prisma.chatEmote.create.mock.calls as Array<
      [{ data: { imageUrl: string } }]
    >) {
      const svg = Buffer.from(data.imageUrl.split(',')[1], 'base64').toString(
        'utf8',
      );
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
    }
  });
});
