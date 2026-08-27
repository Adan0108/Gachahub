import type { Server } from 'socket.io';
import { SocketChatDeliveryService } from './socket-chat-delivery.service';
import { ChatSocketRegistry } from './chat-socket-registry.service';
import { ChatMessageCreatedEvent } from './ports/chat-delivery.port';

describe('SocketChatDeliveryService', () => {
  let registry: ChatSocketRegistry;
  let service: SocketChatDeliveryService;

  const event: ChatMessageCreatedEvent = {
    conversationId: 'conversation-1',
    messageId: 'message-1',
    senderId: 'user-1',
    recipientUserIds: ['user-2', 'user-3'],
    shouldNotify: true,
  };

  beforeEach(() => {
    registry = new ChatSocketRegistry();
    service = new SocketChatDeliveryService(registry);
  });

  it('emits message:created to every recipient room', async () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    registry.server = { to } as unknown as Server;

    await service.publishMessageCreated(event);

    expect(to).toHaveBeenCalledWith('user:user-2');
    expect(to).toHaveBeenCalledWith('user:user-3');
    expect(emit).toHaveBeenCalledWith('message:created', {
      conversationId: 'conversation-1',
      messageId: 'message-1',
      senderId: 'user-1',
      shouldNotify: true,
    });
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('does nothing when no server is registered yet', async () => {
    registry.server = undefined;

    await expect(service.publishMessageCreated(event)).resolves.toBeUndefined();
  });

  it('does not touch the server when there are no recipients', async () => {
    const to = jest.fn();
    registry.server = { to } as unknown as Server;

    await service.publishMessageCreated({ ...event, recipientUserIds: [] });

    expect(to).not.toHaveBeenCalled();
  });
});
