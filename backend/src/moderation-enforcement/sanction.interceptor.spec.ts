jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
import { ForbiddenException } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { of } from 'rxjs';
import { SanctionInterceptor } from './sanction.interceptor';

describe('live socket sanction boundary', () => {
  const access = { assertAllowed: jest.fn(), routeGame: jest.fn() };
  const next = { handle: jest.fn(() => of('ok')) };
  const interceptor = new SanctionInterceptor(access as never);
  const context = (pattern: string, payload: unknown) => ({
    getType: () => 'ws',
    switchToWs: () => ({
      getClient: () => ({
        data: { userId: 'subject', authReady: Promise.resolve() },
      }),
      getPattern: () => pattern,
      getData: () => payload,
    }),
  });
  beforeEach(() => {
    jest.clearAllMocks();
    access.assertAllowed.mockResolvedValue(undefined);
    access.routeGame.mockResolvedValue('actual-game');
  });
  it('checks community joins as reads against the actual community', async () => {
    await interceptor.intercept(
      context('community:join', { slug: 'community' }) as never,
      next,
    );
    expect(access.routeGame).toHaveBeenCalledWith('/games/:gameSlug', {
      gameSlug: 'community',
    });
    expect(access.assertAllowed).toHaveBeenCalledWith(
      'subject',
      false,
      'actual-game',
    );
    expect(next.handle).toHaveBeenCalled();
  });
  it('checks messaging and typing as writes for old sessions', async () => {
    await interceptor.intercept(
      context('typing:start', { conversationId: 'conversation' }) as never,
      next,
    );
    expect(access.assertAllowed).toHaveBeenCalledWith(
      'subject',
      true,
      undefined,
    );
  });
  it('refuses a blocked socket without running its handler or exposing internals', async () => {
    access.assertAllowed.mockRejectedValueOnce(
      new ForbiddenException('Internal detail'),
    );
    await expect(
      interceptor.intercept(
        context('community:join', { slug: 'community' }) as never,
        next,
      ),
    ).rejects.toBeInstanceOf(WsException);
    expect(next.handle).not.toHaveBeenCalled();
  });
});
