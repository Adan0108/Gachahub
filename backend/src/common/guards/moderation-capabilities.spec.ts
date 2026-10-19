import { UserRole } from '../../generated/prisma/client';
import { hasPlatformModerationCapability } from './moderation-capabilities';

describe('hasPlatformModerationCapability', () => {
  it.each([
    [UserRole.USER, false],
    [UserRole.PLATFORM_MODERATOR, true],
    [UserRole.ADMIN, true],
  ])('returns %s capability as %s', (role, expected) => {
    expect(hasPlatformModerationCapability(role)).toBe(expected);
  });
});
