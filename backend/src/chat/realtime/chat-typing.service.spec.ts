import { ChatTypingService } from './chat-typing.service';

describe('ChatTypingService', () => {
  let service: ChatTypingService;

  beforeEach(() => {
    service = new ChatTypingService();
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows the first event for a user', () => {
    expect(
      service.shouldSuppress('user-1', 'conversation-1', 'typing:start'),
    ).toBe(false);
  });

  describe('per-conversation throttle', () => {
    it('suppresses the same event repeated within the throttle window', () => {
      service.shouldSuppress('user-1', 'conversation-1', 'typing:start');

      jest.setSystemTime(500);

      expect(
        service.shouldSuppress('user-1', 'conversation-1', 'typing:start'),
      ).toBe(true);
    });

    it('allows the same event again once the throttle window passes', () => {
      service.shouldSuppress('user-1', 'conversation-1', 'typing:start');

      jest.setSystemTime(2001);

      expect(
        service.shouldSuppress('user-1', 'conversation-1', 'typing:start'),
      ).toBe(false);
    });

    it('does not throttle typing:stop just because typing:start fired', () => {
      service.shouldSuppress('user-1', 'conversation-1', 'typing:start');

      expect(
        service.shouldSuppress('user-1', 'conversation-1', 'typing:stop'),
      ).toBe(false);
    });

    it('does not throttle a different conversation for the same user', () => {
      service.shouldSuppress('user-1', 'conversation-1', 'typing:start');

      expect(
        service.shouldSuppress('user-1', 'conversation-2', 'typing:start'),
      ).toBe(false);
    });

    it('does not throttle the same conversation for a different user', () => {
      service.shouldSuppress('user-1', 'conversation-1', 'typing:start');

      expect(
        service.shouldSuppress('user-2', 'conversation-1', 'typing:start'),
      ).toBe(false);
    });

    it('evicts the oldest tracked conversation once the per-user cap is hit', () => {
      // calls the private throttle check directly (bypassing shouldSuppress's
      // rate limiter) so filling 20 distinct conversations doesn't need real
      // elapsed time - eviction is a memory bound, not a timing behavior
      const typingService = service as unknown as {
        isThrottled: (
          userId: string,
          conversationId: string,
          event: string,
        ) => boolean;
      };
      const isThrottled = (conversationId: string): boolean =>
        typingService.isThrottled('user-1', conversationId, 'typing:start');

      for (let i = 0; i < 20; i++) {
        isThrottled(`conversation-${i}`);
      }

      // one more distinct conversation forces conversation-0 out
      isThrottled('conversation-20');

      // if conversation-0 were still tracked, this immediate repeat (same
      // timestamp) would be throttled; it isn't, because it was evicted
      expect(isThrottled('conversation-0')).toBe(false);
    });
  });

  describe('global rate limit', () => {
    it('allows up to the per-second cap across different conversations', () => {
      for (let i = 0; i < 5; i++) {
        expect(
          service.shouldSuppress('user-1', `conversation-${i}`, 'typing:start'),
        ).toBe(false);
      }
    });

    it('suppresses the next event once the cap is exceeded within the window', () => {
      for (let i = 0; i < 5; i++) {
        service.shouldSuppress('user-1', `conversation-${i}`, 'typing:start');
      }

      expect(
        service.shouldSuppress('user-1', 'conversation-6', 'typing:start'),
      ).toBe(true);
    });

    it('allows events again once the rate-limit window passes', () => {
      for (let i = 0; i < 5; i++) {
        service.shouldSuppress('user-1', `conversation-${i}`, 'typing:start');
      }

      jest.setSystemTime(1001);

      expect(
        service.shouldSuppress('user-1', 'conversation-6', 'typing:start'),
      ).toBe(false);
    });

    it('rate limits per user, not globally', () => {
      for (let i = 0; i < 5; i++) {
        service.shouldSuppress('user-1', `conversation-${i}`, 'typing:start');
      }

      expect(
        service.shouldSuppress('user-2', 'conversation-1', 'typing:start'),
      ).toBe(false);
    });
  });

  describe('clearUser', () => {
    it('resets both the throttle and the rate limit for that user', () => {
      for (let i = 0; i < 5; i++) {
        service.shouldSuppress('user-1', `conversation-${i}`, 'typing:start');
      }
      service.shouldSuppress('user-1', 'conversation-0', 'typing:start');

      service.clearUser('user-1');

      expect(
        service.shouldSuppress('user-1', 'conversation-0', 'typing:start'),
      ).toBe(false);
    });

    it('does not affect other users', () => {
      service.shouldSuppress('user-1', 'conversation-1', 'typing:start');

      service.clearUser('user-2');

      jest.setSystemTime(500);
      expect(
        service.shouldSuppress('user-1', 'conversation-1', 'typing:start'),
      ).toBe(true);
    });
  });
});
