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
    data: {} as { userId?: string },
    handshake: { headers: {} },
    join: jest.fn(),
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
      getSession.mockResolvedValue({ user: { id: 'user-1' } });
      const socket = makeSocket();

      await gateway.handleConnection(socket as any);

      expect(socket.data.userId).toBe('user-1');
      expect(socket.join).toHaveBeenCalledWith('user:user-1');
      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it('disconnects when there is no session', async () => {
      getSession.mockResolvedValue(null);
      const socket = makeSocket();

      await gateway.handleConnection(socket as any);

      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('disconnects when session lookup throws', async () => {
      getSession.mockRejectedValue(new Error('boom'));
      const socket = makeSocket();

      await gateway.handleConnection(socket as any);

      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.join).not.toHaveBeenCalled();
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
