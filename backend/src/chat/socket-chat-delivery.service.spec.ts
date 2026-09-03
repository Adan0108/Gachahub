import type { Server } from 'socket.io';
import { SocketChatDeliveryService } from './socket-chat-delivery.service';
import { SocketRegistry } from '../websocket/socket-registry.service';
import {
  ChatMessageCreatedEvent,
  ChatMessageActionEvent,
} from './ports/chat-delivery.port';

describe('SocketChatDeliveryService', () => {
  let registry: SocketRegistry;
  let service: SocketChatDeliveryService;

  const event: ChatMessageCreatedEvent = {
    conversationId: 'conversation-1',
    messageId: 'message-1',
    senderId: 'user-1',
    recipientUserIds: ['user-2', 'user-3'],
    shouldNotify: true,
  };

  beforeEach(() => {
    registry = new SocketRegistry();
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

  describe('action events (edit/delete/react)', () => {
    const actionEvent: ChatMessageActionEvent = {
      conversationId: 'conversation-1',
      messageId: 'message-1',
      actorId: 'user-1',
      recipientUserIds: ['user-2', 'user-3'],
    };

    const actionMethods: Array<{
      name: string;
      eventName: string;
      call: (event: ChatMessageActionEvent) => Promise<void>;
    }> = [
      {
        name: 'publishMessageEdited',
        eventName: 'message:edited',
        call: (payload) => service.publishMessageEdited(payload),
      },
      {
        name: 'publishMessageDeleted',
        eventName: 'message:deleted',
        call: (payload) => service.publishMessageDeleted(payload),
      },
      {
        name: 'publishReactionAdded',
        eventName: 'reaction:added',
        call: (payload) => service.publishReactionAdded(payload),
      },
      {
        name: 'publishReactionRemoved',
        eventName: 'reaction:removed',
        call: (payload) => service.publishReactionRemoved(payload),
      },
    ];

    it.each(actionMethods)(
      '$name emits $eventName to every recipient room with the actor id',
      async ({ eventName, call }) => {
        const emit = jest.fn();
        const to = jest.fn().mockReturnValue({ emit });
        registry.server = { to } as unknown as Server;

        await call(actionEvent);

        expect(to).toHaveBeenCalledWith('user:user-2');
        expect(to).toHaveBeenCalledWith('user:user-3');
        expect(emit).toHaveBeenCalledWith(eventName, {
          conversationId: 'conversation-1',
          messageId: 'message-1',
          actorId: 'user-1',
        });
        expect(emit).toHaveBeenCalledTimes(2);
      },
    );

    it.each(actionMethods)(
      '$name does nothing when no server is registered yet',
      async ({ call }) => {
        registry.server = undefined;

        await expect(call(actionEvent)).resolves.toBeUndefined();
      },
    );
  });
});
