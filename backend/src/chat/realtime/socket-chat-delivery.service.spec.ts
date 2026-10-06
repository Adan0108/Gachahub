import type { Server } from 'socket.io';
import { SocketChatDeliveryService } from './socket-chat-delivery.service';
import { SocketRegistry } from '../../websocket/socket-registry.service';
import {
  ChatMessageCreatedEvent,
  ChatMessageActionEvent,
} from '../ports/chat-delivery.port';

describe('SocketChatDeliveryService', () => {
  let registry: SocketRegistry;
  let service: SocketChatDeliveryService;

  const event: ChatMessageCreatedEvent = {
    conversationId: 'conversation-1',
    messageId: 'message-1',
    senderId: 'user-1',
    recipientUserIds: ['user-2', 'user-3'],
    shouldNotify: true,
    ciphertext: 'cipher',
    encryptionMeta: null,
    contentType: 'TEXT',
    createdAt: new Date('2024-01-01'),
    clientMessageId: 'client-1',
    replyToId: null,
    media: [],
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
      ciphertext: 'cipher',
      encryptionMeta: null,
      contentType: 'TEXT',
      createdAt: new Date('2024-01-01'),
      clientMessageId: 'client-1',
      replyToId: null,
      media: [],
    });
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('still emits when shouldNotify is false, muting only gates the client-side badge', async () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    registry.server = { to } as unknown as Server;

    await service.publishMessageCreated({ ...event, shouldNotify: false });

    expect(to).toHaveBeenCalledWith('user:user-2');
    expect(to).toHaveBeenCalledWith('user:user-3');
    expect(emit).toHaveBeenCalledWith(
      'message:created',
      expect.objectContaining({ shouldNotify: false }),
    );
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

  describe('publishReceiptsUpdated', () => {
    const emitTo = () => {
      const emit = jest.fn();
      const to = jest.fn().mockReturnValue({ emit });
      registry.server = { to } as unknown as Server;
      return { emit, to };
    };
    const at = new Date('2026-10-06T10:00:00.000Z');

    it('sends delivered messages to every recipient, saying who and which messages', async () => {
      const { emit, to } = emitTo();

      await service.publishReceiptsUpdated({
        kind: 'delivered',
        conversationId: 'conversation-1',
        readerId: 'user-2',
        recipientUserIds: ['user-1', 'user-3'],
        messageIds: ['message-1', 'message-2'],
      });

      expect(to).toHaveBeenCalledWith('user:user-1');
      expect(to).toHaveBeenCalledWith('user:user-3');
      expect(emit).toHaveBeenCalledWith('receipts:updated', {
        kind: 'delivered',
        conversationId: 'conversation-1',
        userId: 'user-2',
        messageIds: ['message-1', 'message-2'],
      });
    });

    it('sends how far someone has read, without a list of messages', async () => {
      const { emit } = emitTo();

      await service.publishReceiptsUpdated({
        kind: 'read',
        conversationId: 'conversation-1',
        readerId: 'user-2',
        recipientUserIds: ['user-1'],
        upToMessageId: 'message-9',
        at,
      });

      expect(emit).toHaveBeenCalledWith('receipts:updated', {
        kind: 'read',
        conversationId: 'conversation-1',
        userId: 'user-2',
        upToMessageId: 'message-9',
        at,
      });
    });

    it('does not say who else got the event', async () => {
      const { emit } = emitTo();

      await service.publishReceiptsUpdated({
        kind: 'read',
        conversationId: 'conversation-1',
        readerId: 'user-2',
        recipientUserIds: ['user-1', 'user-3'],
        upToMessageId: 'message-9',
        at,
      });

      expect(JSON.stringify(emit.mock.calls[0])).not.toContain(
        'recipientUserIds',
      );
    });

    it('does nothing when no server is registered yet', async () => {
      registry.server = undefined;

      await expect(
        service.publishReceiptsUpdated({
          kind: 'read',
          conversationId: 'conversation-1',
          readerId: 'user-2',
          recipientUserIds: ['user-1'],
          upToMessageId: 'message-9',
          at,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('publishRequestAccepted', () => {
    it('emits request:accepted to every recipient room with the accepter id', async () => {
      const emit = jest.fn();
      const to = jest.fn().mockReturnValue({ emit });
      registry.server = { to } as unknown as Server;

      await service.publishRequestAccepted({
        conversationId: 'conversation-1',
        userId: 'user-2',
        recipientUserIds: ['user-1'],
      });

      expect(to).toHaveBeenCalledWith('user:user-1');
      expect(emit).toHaveBeenCalledWith('request:accepted', {
        conversationId: 'conversation-1',
        userId: 'user-2',
      });
    });

    it('does nothing when no server is registered yet', async () => {
      registry.server = undefined;

      await expect(
        service.publishRequestAccepted({
          conversationId: 'conversation-1',
          userId: 'user-2',
          recipientUserIds: ['user-1'],
        }),
      ).resolves.toBeUndefined();
    });
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
