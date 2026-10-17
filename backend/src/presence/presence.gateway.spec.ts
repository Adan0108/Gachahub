import { PresenceGateway } from './presence.gateway';

describe('PresenceGateway', () => {
  const presence = { socketAlive: jest.fn(), socketGone: jest.fn() };
  let gateway: PresenceGateway;

  const socket = (
    userId?: string,
    authReady: Promise<void> = Promise.resolve(),
  ) => ({ id: 's1', data: { userId, authReady } }) as never;

  beforeEach(() => {
    jest.resetAllMocks();
    presence.socketAlive.mockResolvedValue(undefined);
    presence.socketGone.mockResolvedValue(undefined);
    gateway = new PresenceGateway(presence as never);
  });

  it('marks a socket alive on connect and on each ping', async () => {
    await gateway.handleConnection(socket('me'));
    await gateway.handlePing(socket('me'));

    expect(presence.socketAlive).toHaveBeenCalledTimes(2);
    expect(presence.socketAlive).toHaveBeenCalledWith('me', 's1');
  });

  it('waits for authentication to finish before reading who the socket is', async () => {
    const data: { userId?: string; authReady?: Promise<void> } = {};
    data.authReady = new Promise<void>((resolve) =>
      setTimeout(() => {
        data.userId = 'late';
        resolve();
      }, 5),
    );

    await gateway.handleConnection({ id: 's1', data } as never);

    expect(presence.socketAlive).toHaveBeenCalledWith('late', 's1');
  });

  it('ignores a socket that never authenticated', async () => {
    await gateway.handleConnection(socket(undefined));
    await gateway.handleDisconnect(socket(undefined));

    expect(presence.socketAlive).not.toHaveBeenCalled();
    expect(presence.socketGone).not.toHaveBeenCalled();
  });

  it('marks the socket gone on disconnect', async () => {
    await gateway.handleDisconnect(socket('me'));

    expect(presence.socketGone).toHaveBeenCalledWith('me', 's1');
  });

  it('does not let a store failure break the connection', async () => {
    presence.socketAlive.mockRejectedValue(new Error('redis down'));
    presence.socketGone.mockRejectedValue(new Error('redis down'));

    await expect(
      gateway.handleConnection(socket('me')),
    ).resolves.toBeUndefined();
    await expect(
      gateway.handleDisconnect(socket('me')),
    ).resolves.toBeUndefined();
  });
});
