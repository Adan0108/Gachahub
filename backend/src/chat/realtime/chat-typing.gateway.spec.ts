jest.mock('../chat.service', () => ({
  ChatService: class {},
}));

import type { Server } from 'socket.io';
import { ChatTypingGateway } from './chat-typing.gateway';
import { ChatTypingService } from './chat-typing.service';

describe('ChatTypingGateway', () => {
  const chatService = {
    getTypingRecipients: jest.fn(),
  };

  let chatTypingService: ChatTypingService;
  let gateway: ChatTypingGateway;
  let server: { to: jest.Mock; emit: jest.Mock };

  const makeSocket = (overrides: Record<string, unknown> = {}) => ({
    id: 'socket-1',
    data: {} as { userId?: string },
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    chatTypingService = new ChatTypingService();
    gateway = new ChatTypingGateway(chatService as any, chatTypingService);
    server = { to: jest.fn(), emit: jest.fn() };
    server.to.mockReturnValue(server);
    gateway.server = server as unknown as Server;
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

    it('does nothing when ChatTypingService suppresses the event', async () => {
      chatService.getTypingRecipients.mockResolvedValue(['user-2']);
      const socket = makeSocket({ data: { userId: 'user-1' } });

      await gateway.handleTypingStart(socket as any, {
        conversationId: 'conversation-1',
      });
      jest.clearAllMocks();

      await gateway.handleTypingStart(socket as any, {
        conversationId: 'conversation-1',
      });

      expect(chatService.getTypingRecipients).not.toHaveBeenCalled();
      expect(server.to).not.toHaveBeenCalled();
    });
  });

  describe('handleDisconnect', () => {
    it('clears the typing throttle state for the disconnecting user', () => {
      const clearUserSpy = jest.spyOn(chatTypingService, 'clearUser');
      const socket = makeSocket({ data: { userId: 'user-1' } });

      gateway.handleDisconnect(socket as any);

      expect(clearUserSpy).toHaveBeenCalledWith('user-1');
    });

    it('does nothing when the socket has no authenticated user', () => {
      const clearUserSpy = jest.spyOn(chatTypingService, 'clearUser');
      const socket = makeSocket();

      gateway.handleDisconnect(socket as any);

      expect(clearUserSpy).not.toHaveBeenCalled();
    });
  });
});
