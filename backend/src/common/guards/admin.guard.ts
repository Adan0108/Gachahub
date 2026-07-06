import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { USER_ROLES } from '../constants/roles.constants';
import { PrismaService } from '../../prisma/prisma.service';

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
    const userId = request.user?.id;

    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    const user = await this.prisma.user.findUnique({
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

    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('User account is not active');
    }

    if (user.role !== USER_ROLES.ADMIN) {
      throw new ForbiddenException('Admin permission required');
    }

    return true;
  }
}
