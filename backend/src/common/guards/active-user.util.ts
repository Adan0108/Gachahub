import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UserStatus } from '../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Loads the authenticated user and verifies their account is ACTIVE - the
 * two checks every authorization entry point needs before deciding whether
 * the specific permission (admin, game moderator, ...) applies. Shared by
 * AdminGuard and GameModeratorsService.assertCanModerateGame so there's one
 * canonical answer for "is this user allowed to act at all", including
 * which HTTP status each failure maps to (401 when we don't know who they
 * are, 403 when we do and they're blocked).
 */
export async function loadActiveUser(
  prisma: PrismaService,
  userId: string | undefined,
) {
  if (!userId) {
    throw new UnauthorizedException('Authentication required');
  }

  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      role: true,
      status: true,
    },
  });

  if (!user) {
    throw new UnauthorizedException('User not found');
  }

  if (user.status !== UserStatus.ACTIVE) {
    throw new ForbiddenException('User account is not active');
  }

  return user;
}
