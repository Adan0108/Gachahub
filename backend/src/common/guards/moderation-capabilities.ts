import { UserRole } from '../../generated/prisma/client';
import type { Prisma } from '../../generated/prisma/client';

export function hasPlatformModerationCapability(role: UserRole): boolean {
  return role === UserRole.PLATFORM_MODERATOR || role === UserRole.ADMIN;
}

/** Shared eligibility for case search and assignment, independent of chat blocks. */
export function caseModeratorWhere(
  gameId: string | null,
): Prisma.UserWhereInput {
  const platformRoles = Object.values(UserRole).filter(
    hasPlatformModerationCapability,
  );
  return {
    status: 'ACTIVE',
    OR: [
      { role: { in: platformRoles } },
      ...(gameId === null ? [] : [{ moderatedGames: { some: { gameId } } }]),
    ],
  };
}
