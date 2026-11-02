jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('@thallesp/nestjs-better-auth', () => ({
  AllowAnonymous: () => () => undefined,
}));
import { CommunityAccessService } from '../community-chat/community-access.service';
import { RequestOriginInterceptor } from '../common/security/request-origin.interceptor';
import { of } from 'rxjs';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { CommunityChatRepository } from '../community-chat/community-chat.repository';
import { GameModeratorsRepository } from '../game-moderators/game-moderators.repository';

describe('audit authorization and probe regressions', () => {
  it('fails module composition instead of silently omitting community sanction enforcement', async () => {
    await expect(
      Test.createTestingModule({
        providers: [
          CommunityAccessService,
          { provide: PrismaService, useValue: {} },
          { provide: CommunityChatRepository, useValue: {} },
          { provide: GameModeratorsRepository, useValue: {} },
        ],
      }).compile(),
    ).rejects.toThrow('SanctionAccessService');
  });
  it('rejects cookie-authenticated writes without Origin or Referer', () => {
    const interceptor = new RequestOriginInterceptor();
    expect(() =>
      interceptor.intercept(
        {
          getType: () => 'http',
          switchToHttp: () => ({
            getRequest: () => ({
              user: { id: 'user' },
              method: 'POST',
              path: '/posts',
              params: {},
              headers: { cookie: 'session=fixture' },
            }),
          }),
        } as never,
        { handle: () => of('unsafe') },
      ),
    ).toThrow();
  });
  it('uses write authorization at the community service boundary', async () => {
    const sanctions = { assertAllowed: jest.fn() };
    const service = new CommunityAccessService(
      {
        findGameBySlug: jest
          .fn()
          .mockResolvedValue({ id: 'game', status: 'ACTIVE' }),
        findMembership: jest.fn().mockResolvedValue({}),
      } as never,
      {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'user',
            status: 'ACTIVE',
            role: 'USER',
          }),
        },
      } as never,
      { findByGameIdAndUserId: jest.fn().mockResolvedValue(null) } as never,
      sanctions as never,
    );
    await service.scope('game', 'user', true);
    expect(sanctions.assertAllowed).toHaveBeenCalledWith('user', true, 'game');
  });
});
