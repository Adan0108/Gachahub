import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { UserRole } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { loadActiveUser } from './active-user.util';

type AuthenticatedRequest = Request & {
  user?: {
    id?: string;
  };
};

/**
 * AdminGuard protects routes that should only be accessible by system admins.
 *
 * Better Auth already checks whether the user is logged in.
 * This guard adds the second layer:
 * - read the authenticated user id from request.user
 * - query Prisma to get the latest user role
 * - allow only users with role ADMIN
 *
 * This keeps authentication and authorization separated:
 * - Better Auth = who are you?
 * - AdminGuard = are you allowed to do this admin action?
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Determines whether the current request can access the route.
   *
   * @param context NestJS execution context for the current request.
   * @returns true when the user is an ADMIN.
   * @throws UnauthorizedException when no authenticated user exists.
   * @throws ForbiddenException when the user exists but is not ADMIN.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await loadActiveUser(this.prisma, request.user?.id);

    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin permission required');
    }

    return true;
  }
}
