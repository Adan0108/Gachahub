jest.mock('../auth/auth', () => ({
  auth: { api: { getSession: jest.fn() } },
}));
jest.mock('./chat.service', () => ({
  ChatService: class {},
}));

import type { Server } from 'socket.io';
import { ChatGateway } from './chat.gateway';
import { auth } from '../auth/auth';

const getSession = auth.api.getSession as unknown as jest.Mock;

describe('ChatGateway', () => {
  const chatService = {
    getTypingRecipients: jest.fn(),
  };

  const socketRegistry: { server?: unknown } = {};

  let gateway: ChatGateway;
  let server: { to: jest.Mock; emit: jest.Mock };

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
    gateway = new ChatGateway(chatService as any, socketRegistry as any);
    server = { to: jest.fn(), emit: jest.fn() };
    server.to.mockReturnValue(server);
    gateway.server = server as unknown as Server;
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

  describe('typing broadcast', () => {
    it('broadcasts typing:start to every recipient room', async () => {
      chatService.getTypingRecipients.mockResolvedValue(['user-2', 'user-3']);
      const socket = makeSocket({ data: { userId: 'user-1' } });

      await gateway.handleTypingStart(socket as any, {
        conversationId: 'conversation-1',
      });

      expect(chatService.getTypingRecipients).toHaveBeenCalledWith(
        'conversation-1',
        'user-1',
      );
      expect(server.to).toHaveBeenCalledWith('user:user-2');
      expect(server.to).toHaveBeenCalledWith('user:user-3');
      expect(server.emit).toHaveBeenCalledWith('typing:start', {
        conversationId: 'conversation-1',
        userId: 'user-1',
      });
    });

    it('broadcasts typing:stop the same way', async () => {
      chatService.getTypingRecipients.mockResolvedValue(['user-2']);
      const socket = makeSocket({ data: { userId: 'user-1' } });

      await gateway.handleTypingStop(socket as any, {
        conversationId: 'conversation-1',
      });

      expect(server.to).toHaveBeenCalledWith('user:user-2');
      expect(server.emit).toHaveBeenCalledWith('typing:stop', {
        conversationId: 'conversation-1',
        userId: 'user-1',
      });
    });

    it('does nothing when the socket has no authenticated user', async () => {
      const socket = makeSocket();

      await gateway.handleTypingStart(socket as any, {
        conversationId: 'conversation-1',
      });

      expect(chatService.getTypingRecipients).not.toHaveBeenCalled();
      expect(server.to).not.toHaveBeenCalled();
    });

    it('does nothing when the payload has no conversationId', async () => {
      const socket = makeSocket({ data: { userId: 'user-1' } });

      await gateway.handleTypingStart(socket as any, {} as any);

      expect(chatService.getTypingRecipients).not.toHaveBeenCalled();
      expect(server.to).not.toHaveBeenCalled();
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
