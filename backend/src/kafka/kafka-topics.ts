import type { DomainEventType } from '../domain-events/domain-event.types';

export const KAFKA_TOPICS = {
  POSTS: 'gachahub.posts',
  SOCIAL: 'gachahub.social',
  CHAT: 'gachahub.chat',
} as const;

export type KafkaTopic = (typeof KAFKA_TOPICS)[keyof typeof KAFKA_TOPICS];

export function resolveDomainEventTopic(type: DomainEventType): KafkaTopic {
  switch (type) {
    case 'post.liked':
    case 'comment.created':
      return KAFKA_TOPICS.POSTS;

    case 'user.followed':
    case 'user.mentioned':
      return KAFKA_TOPICS.SOCIAL;

    case 'chat.message.sent':
    case 'chat.participant.added':
      return KAFKA_TOPICS.CHAT;
  }
}
