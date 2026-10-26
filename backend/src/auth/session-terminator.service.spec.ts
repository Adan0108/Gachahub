const deleteSession = jest.fn();

jest.mock('./auth', () => ({
  auth: { $context: Promise.resolve({ internalAdapter: { deleteSession } }) },
}));

import type { PrismaService } from '../prisma/prisma.service';

jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

import { SessionTerminator } from './session-terminator.service';

describe('SessionTerminator', () => {
  const sockets = { endSessions: jest.fn() };
  const prisma = { session: { findMany: jest.fn() } };
  const redis = { publish: jest.fn() };
  let terminator: SessionTerminator;

  beforeEach(() => {
    jest.clearAllMocks();
    redis.publish.mockResolvedValue(1);
    terminator = new SessionTerminator(
      sockets,
      prisma as unknown as PrismaService,
      redis as never,
    );
  });

  it('deletes each login through better-auth, then signs its open browsers out', async () => {
    deleteSession.mockResolvedValue(undefined);

    await terminator.end([
      { id: 's1', token: 't1' },
      { id: 's2', token: 't2' },
    ]);

    expect(deleteSession).toHaveBeenCalledWith('t1');
    expect(deleteSession).toHaveBeenCalledWith('t2');
    expect(sockets.endSessions).toHaveBeenCalledWith(['s1', 's2']);
  });

  // R2-03: sockets connected to another backend instance are signed out too
  it('tells the other instances which logins ended', async () => {
    deleteSession.mockResolvedValue(undefined);

    await terminator.end([{ id: 's1', token: 't1' }]);

    expect(redis.publish).toHaveBeenCalledWith(
      expect.stringContaining('sessions-ended'),
      JSON.stringify(['s1']),
    );
  });

  it('signs out the sockets another instance reports ended', async () => {
    let listener!: (message: string) => void;
    const subscriber = {
      on: jest.fn(),
      connect: jest.fn(),
      subscribe: jest.fn((_channel: string, fn: (message: string) => void) => {
        listener = fn;
      }),
    };
    const withChannel = new SessionTerminator(
      sockets,
      prisma as unknown as PrismaService,
      {
        ...redis,
        duplicate: () => subscriber,
      } as never,
    );
    await withChannel.onModuleInit();

    listener(JSON.stringify(['s9']));

    expect(sockets.endSessions).toHaveBeenCalledWith(['s9']);
  });

  it('still ends the login here when the other instances cannot be told', async () => {
    deleteSession.mockResolvedValue(undefined);
    redis.publish.mockRejectedValue(new Error('redis down'));

    await expect(
      terminator.end([{ id: 's1', token: 't1' }]),
    ).resolves.toBeUndefined();
    expect(sockets.endSessions).toHaveBeenCalledWith(['s1']);
  });

  it('still ends the others when one fails, then reports the failure', async () => {
    deleteSession
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(undefined);

    await expect(
      terminator.end([
        { id: 's1', token: 't1' },
        { id: 's2', token: 't2' },
      ]),
    ).rejects.toThrow('db down');

    expect(deleteSession).toHaveBeenCalledTimes(2);
    expect(sockets.endSessions).toHaveBeenCalledWith(['s2']);
  });

  describe('endAllForUser', () => {
    it("looks up the user's sessions, then ends them", async () => {
      prisma.session.findMany.mockResolvedValue([{ id: 's1', token: 't1' }]);
      deleteSession.mockResolvedValue(undefined);

      await terminator.endAllForUser('user-1');

      expect(prisma.session.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        select: { id: true, token: true },
      });
      expect(deleteSession).toHaveBeenCalledWith('t1');
    });

    it('no-ops when the user has no active sessions', async () => {
      prisma.session.findMany.mockResolvedValue([]);

      await terminator.endAllForUser('user-1');

      expect(deleteSession).not.toHaveBeenCalled();
    });
  });
});
