jest.mock('../auth/auth', () => ({
  auth: { api: { getSession: jest.fn() } },
}));

import { WebsocketGateway } from './websocket.gateway';
import { SocketRegistry } from './socket-registry.service';
import { auth } from '../auth/auth';

const getSession = auth.api.getSession as unknown as jest.Mock;

describe('WebsocketGateway', () => {
  let gateway: WebsocketGateway;
  let socketRegistry: SocketRegistry;

  const makeSocket = (overrides: Record<string, unknown> = {}) => ({
    id: 'socket-1',
    data: {} as {
      userId?: string;
      authReady?: Promise<void>;
      sessionExpiresAt?: number;
    },
    handshake: { headers: {} },
    join: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    socketRegistry = new SocketRegistry();
    gateway = new WebsocketGateway(socketRegistry);
  });

  describe('handleConnection', () => {
    it('joins the user room on a valid session', async () => {
      getSession.mockResolvedValue({
        user: { id: 'user-1' },
        session: { id: 'session-1' },
      });
      const socket = makeSocket();

      await gateway.handleConnection(socket as any);

      expect(socket.data.userId).toBe('user-1');
      expect(socket.join).toHaveBeenCalledWith('user:user-1');
      expect(socket.join).toHaveBeenCalledWith('session:session-1');
      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it('sets authReady synchronously, before auth resolves, so a sibling gateway on this socket has something to await instead of reading userId too early', async () => {
      let resolveSession: (value: unknown) => void = () => {};
      getSession.mockReturnValue(
        new Promise((resolve) => {
          resolveSession = resolve;
        }),
      );
      const socket = makeSocket();

      const connectionPromise = gateway.handleConnection(socket as any);

      expect(socket.data.authReady).toBeInstanceOf(Promise);
      expect(socket.data.userId).toBeUndefined();

      resolveSession({ user: { id: 'user-1' }, session: { id: 'session-1' } });
      await connectionPromise;
      await socket.data.authReady;

      expect(socket.data.userId).toBe('user-1');
    });

    it('tells the browser it is signed out, then disconnects, when there is no session', async () => {
      getSession.mockResolvedValue(null);
      const socket = makeSocket();

      await gateway.handleConnection(socket as any);

      expect(socket.emit).toHaveBeenCalledWith('session:revoked');
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('disconnects on a backend error WITHOUT any signed-out signal - a hiccup must not log people out', async () => {
      getSession.mockRejectedValue(new Error('boom'));
      const socket = makeSocket();

      await gateway.handleConnection(socket as any);

      expect(socket.emit).not.toHaveBeenCalled();
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.join).not.toHaveBeenCalled();
    });
  });

  // #100: a socket authenticated once must not outlive its login.
  describe('session expiry', () => {
    const session = (expiresAt: number) => ({
      user: { id: 'user-1' },
      session: { id: 'session-1', expiresAt: new Date(expiresAt) },
    });

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('checks the login again right after joining its rooms, without extending it', async () => {
      getSession.mockResolvedValue(session(Date.now() + 60_000));
      const socket = makeSocket();

      await gateway.handleConnection(socket as any);

      expect(getSession).toHaveBeenCalledTimes(2);
      expect(getSession).toHaveBeenLastCalledWith(
        expect.objectContaining({ query: { disableRefresh: true } }),
      );
      expect(socket.disconnect).not.toHaveBeenCalled();
      gateway.handleDisconnect(socket as any);
    });

    it('closes a socket whose login was revoked while it was joining its rooms', async () => {
      getSession
        .mockResolvedValueOnce(session(Date.now() + 60_000))
        .mockResolvedValueOnce(null);
      const socket = makeSocket();

      await gateway.handleConnection(socket as any);

      expect(socket.emit).toHaveBeenCalledWith('session:revoked');
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('closes the socket when its login expires', async () => {
      getSession.mockResolvedValue(session(Date.now() + 5_000));
      const socket = makeSocket();
      await gateway.handleConnection(socket as any);

      getSession.mockResolvedValue(null);
      await jest.advanceTimersByTimeAsync(5_000);

      expect(socket.emit).toHaveBeenCalledWith('session:revoked');
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('keeps the socket of a login renewed before it expired, and checks again at the new expiry', async () => {
      getSession.mockResolvedValue(session(Date.now() + 5_000));
      const socket = makeSocket();
      await gateway.handleConnection(socket as any);

      const renewedUntil = Date.now() + 5_000 + 60_000;
      getSession.mockResolvedValue(session(renewedUntil));
      await jest.advanceTimersByTimeAsync(5_000);

      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(socket.data).toMatchObject({ sessionExpiresAt: renewedUntil });
      gateway.handleDisconnect(socket as any);
    });

    it('checks at least every 10 minutes, so a login deleted without a revoke still ends', async () => {
      getSession.mockResolvedValue(session(Date.now() + 7 * 24 * 3_600_000));
      const socket = makeSocket();
      await gateway.handleConnection(socket as any);

      getSession.mockResolvedValue(null);
      await jest.advanceTimersByTimeAsync(10 * 60_000);

      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('stops checking once the socket is gone', async () => {
      getSession.mockResolvedValue(session(Date.now() + 5_000));
      const socket = makeSocket();
      await gateway.handleConnection(socket as any);
      getSession.mockClear();

      gateway.handleDisconnect(socket as any);
      await jest.advanceTimersByTimeAsync(10 * 60_000);

      expect(getSession).not.toHaveBeenCalled();
    });
  });

  describe('handleDisconnect', () => {
    it('does not throw', () => {
      const socket = makeSocket();

      expect(() => gateway.handleDisconnect(socket as any)).not.toThrow();
    });
  });

  describe('afterInit', () => {
    it('shares the server instance with the socket registry', () => {
      const ioServer = {};

      gateway.afterInit(ioServer as any);

      expect(socketRegistry.server).toBe(ioServer);
    });
  });
});
