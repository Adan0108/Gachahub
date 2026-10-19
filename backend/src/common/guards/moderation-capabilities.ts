import { UserRole } from '../../generated/prisma/client';

export function hasPlatformModerationCapability(role: UserRole): boolean {
  return role === UserRole.PLATFORM_MODERATOR || role === UserRole.ADMIN;
}
