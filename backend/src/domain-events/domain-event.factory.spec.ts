import {
  DOMAIN_EVENT_TYPES,
  type DomainEventPayloadMap,
} from './domain-event.types';
import { createDomainEvent } from './domain-event.factory';

describe('createDomainEvent', () => {
  it('should create a post liked domain event', () => {
    const payload: DomainEventPayloadMap['post.liked'] = {
      postId: 'post-1',
      postAuthorId: 'user-1',
      actorId: 'user-2',
    };

    const event = createDomainEvent({
      type: DOMAIN_EVENT_TYPES.POST_LIKED,
      aggregateId: payload.postId,
      payload,
    });

    expect(event.eventId).toBeDefined();

    expect(event.type).toBe(DOMAIN_EVENT_TYPES.POST_LIKED);

    expect(event.version).toBe(1);

    expect(event.aggregateId).toBe('post-1');

    expect(event.payload).toEqual(payload);

    expect(Number.isNaN(Date.parse(event.occurredAt))).toBe(false);
  });

  it('should allow an explicit event version', () => {
    const event = createDomainEvent({
      type: DOMAIN_EVENT_TYPES.USER_FOLLOWED,

      aggregateId: 'user-target',

      version: 2,

      payload: {
        targetUserId: 'user-target',
        actorId: 'user-actor',
      },
    });

    expect(event.version).toBe(2);
  });

  it('should create different event ids', () => {
    const first = createDomainEvent({
      type: DOMAIN_EVENT_TYPES.USER_FOLLOWED,

      aggregateId: 'user-target',

      payload: {
        targetUserId: 'user-target',
        actorId: 'user-a',
      },
    });

    const second = createDomainEvent({
      type: DOMAIN_EVENT_TYPES.USER_FOLLOWED,

      aggregateId: 'user-target',

      payload: {
        targetUserId: 'user-target',
        actorId: 'user-b',
      },
    });

    expect(first.eventId).not.toBe(second.eventId);
  });

  it('should create an encrypted chat message metadata event', () => {
    const event = createDomainEvent({
      type: DOMAIN_EVENT_TYPES.CHAT_MESSAGE_SENT,

      aggregateId: 'conversation-1',

      payload: {
        messageId: 'message-1',
        conversationId: 'conversation-1',
        senderId: 'user-1',
        replyToMessageId: null,
      },
    });

    expect(event.payload).toEqual({
      messageId: 'message-1',
      conversationId: 'conversation-1',
      senderId: 'user-1',
      replyToMessageId: null,
    });

    expect('ciphertext' in event.payload).toBe(false);

    expect('content' in event.payload).toBe(false);
  });
});
