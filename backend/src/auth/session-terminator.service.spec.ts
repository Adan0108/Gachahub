const deleteSession = jest.fn();

jest.mock('./auth', () => ({
  auth: { $context: Promise.resolve({ internalAdapter: { deleteSession } }) },
}));

import { SessionTerminator } from './session-terminator.service';

describe('SessionTerminator', () => {
  const sockets = { endSessions: jest.fn() };
  let terminator: SessionTerminator;

  beforeEach(() => {
    jest.clearAllMocks();
    terminator = new SessionTerminator(sockets);
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
});
