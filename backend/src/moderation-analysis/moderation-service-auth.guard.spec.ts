import type { ExecutionContext } from '@nestjs/common';
import { ModerationServiceAuthGuard } from './moderation-service-auth.guard';

const token = 'test-only-' + 'a'.repeat(32);
const originalToken = process.env.MODERATION_WORKER_TOKEN;
afterAll(() => {
  if (originalToken === undefined) delete process.env.MODERATION_WORKER_TOKEN;
  else process.env.MODERATION_WORKER_TOKEN = originalToken;
});
function context(authorization?: unknown) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  } as unknown as ExecutionContext;
}
describe('moderation service authentication', () => {
  beforeEach(() => {
    process.env.MODERATION_WORKER_TOKEN = token;
  });
  it.each([undefined, '', 'short', 'a'.repeat(513), 'a'.repeat(32) + ' '])(
    'rejects invalid startup configuration %#',
    (invalid) => {
      if (invalid === undefined) delete process.env.MODERATION_WORKER_TOKEN;
      else process.env.MODERATION_WORKER_TOKEN = invalid;
      expect(() => new ModerationServiceAuthGuard()).toThrow(
        'MODERATION_WORKER_TOKEN',
      );
    },
  );
  it.each([
    undefined,
    '',
    'Basic x',
    'Bearer wrong',
    ['Bearer ' + token],
    'Bearer ' + 'b'.repeat(token.length),
    'Bearer ' + token + 'x',
  ])('rejects invalid/missing service token %#', (authorization) => {
    expect(() =>
      new ModerationServiceAuthGuard().canActivate(context(authorization)),
    ).toThrow();
  });
  it('accepts the configured service token', () => {
    expect(
      new ModerationServiceAuthGuard().canActivate(context('Bearer ' + token)),
    ).toBe(true);
  });
});
