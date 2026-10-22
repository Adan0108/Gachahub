import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { loadActiveUser } from './active-user.util';
import { hasPlatformModerationCapability } from './moderation-capabilities';

type AuthenticatedRequest = Request & {
  user?: {
    id?: string;
  };
};

/**
 * Allows active users with platform moderation capability (including ADMIN).
 * Better Auth handles authentication; loadActiveUser checks the live database
 * role and account status before this guard checks capability.
 */
@Injectable()
export class PlatformModeratorGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await loadActiveUser(this.prisma, request.user?.id);

    if (!hasPlatformModerationCapability(user.role)) {
      throw new ForbiddenException('PlatformModerator permission required');
    }

    return true;
  }
}
