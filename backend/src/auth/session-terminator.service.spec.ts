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
  let terminator: SessionTerminator;

  beforeEach(() => {
    jest.clearAllMocks();
    terminator = new SessionTerminator(
      sockets,
      prisma as unknown as PrismaService,
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
