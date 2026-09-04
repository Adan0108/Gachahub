import { Injectable } from '@nestjs/common';

export type TypingEventName = 'typing:start' | 'typing:stop';

/**
 * Decides whether a typing event should actually broadcast.
 *
 * Combines a global per-user rate limit (closes the fake-conversation-id
 * memory-growth vector) with a per-conversation throttle (stops the same
 * conversation being spammed once the rate limit alone would still allow it).
 */
@Injectable()
export class ChatTypingService {
  private readonly TYPING_THROTTLE_MS = 2000;
  private readonly TYPING_RATE_LIMIT_WINDOW_MS = 1000;
  private readonly TYPING_RATE_LIMIT_MAX_EVENTS = 5;
  private readonly MAX_TRACKED_CONVERSATIONS_PER_USER = 20;
  private readonly typingThrottle = new Map<string, Map<string, number>>();
  private readonly typingRateLimiter = new Map<string, number[]>();

  /**
   * True when this event should be suppressed instead of broadcast.
   */
  shouldSuppress(
    userId: string,
    conversationId: string,
    event: TypingEventName,
  ): boolean {
    if (this.isRateLimited(userId)) {
      return true;
    }

    return this.isThrottled(userId, conversationId, event);
  }

  /**
   * Clears this user's typing-throttle state, e.g. on socket disconnect.
   */
  clearUser(userId: string): void {
    this.typingThrottle.delete(userId);
    this.typingRateLimiter.delete(userId);
  }

  /**
   * True when this user has already fired too many typing events across all
   * conversations recently. Checked before the per-conversation map is ever
   * touched, so spamming distinct/fake conversation ids can't grow it unbounded.
   */
  private isRateLimited(userId: string): boolean {
    const now = Date.now();
    const windowStart = now - this.TYPING_RATE_LIMIT_WINDOW_MS;
    const recentEvents = (this.typingRateLimiter.get(userId) ?? []).filter(
      (timestamp) => timestamp > windowStart,
    );

    if (recentEvents.length >= this.TYPING_RATE_LIMIT_MAX_EVENTS) {
      this.typingRateLimiter.set(userId, recentEvents);
      return true;
    }

    recentEvents.push(now);
    this.typingRateLimiter.set(userId, recentEvents);
    return false;
  }

  /**
   * True when this user already fired the same typing event for this
   * conversation within the throttle window; records the emit otherwise.
   */
  private isThrottled(
    userId: string,
    conversationId: string,
    event: TypingEventName,
  ): boolean {
    const now = Date.now();
    const key = `${event}:${conversationId}`;
    const userThrottle = this.typingThrottle.get(userId);
    const lastEmittedAt = userThrottle?.get(key);

    if (
      lastEmittedAt !== undefined &&
      now - lastEmittedAt < this.TYPING_THROTTLE_MS
    ) {
      return true;
    }

    if (userThrottle) {
      if (
        !userThrottle.has(key) &&
        userThrottle.size >= this.MAX_TRACKED_CONVERSATIONS_PER_USER
      ) {
        const [oldestKey] = userThrottle.keys();
        userThrottle.delete(oldestKey);
      }

      userThrottle.set(key, now);
    } else {
      this.typingThrottle.set(userId, new Map([[key, now]]));
    }

    return false;
  }
}
