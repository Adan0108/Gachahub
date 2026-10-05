import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { UserModerationAuditAction } from '../audit-log/audit-log.types';
import { PrismaService } from '../prisma/prisma.service';
import { SessionTerminator } from '../auth/session-terminator.service';
import { UserRole, UserStatus } from '../generated/prisma/client';
import { ADMIN_SETTABLE_USER_STATUSES } from './dto/update-user-status.dto';
import { QueryUsersAdminDto } from './dto/query-users-admin.dto';
import { UsersRepository } from './users.repository';
import { resolvePagination, toPaginated } from '../common/utils/paginated';

type AdminSettableUserStatus = (typeof ADMIN_SETTABLE_USER_STATUSES)[number];

const AUDIT_ACTION_BY_STATUS: Record<
  AdminSettableUserStatus,
  UserModerationAuditAction
> = {
  BANNED: 'USER_BANNED',
  SUSPENDED: 'USER_SUSPENDED',
  ACTIVE: 'USER_REACTIVATED',
};

/**
 * Admin actions on user accounts: listing, and changing status (ban /
 * suspend / reactivate). Never deletes a row - see the schema comment on
 * User.status and BACKLOG's account-moderation note: a banned user's past
 * messages/posts must stay visible to others, so only status ever changes.
 */
@Injectable()
export class UserModerationService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly auditLogService: AuditLogService,
    private readonly sessionTerminator: SessionTerminator,
    private readonly prisma: PrismaService,
  ) {}

  async listForAdmin(query: QueryUsersAdminDto) {
    const { page, limit } = resolvePagination(query);

    const result = await this.usersRepository.findManyForAdmin({
      status: query.status,
      role: query.role,
      search: query.search,
      page,
      limit,
    });

    return toPaginated(result.items, { page, limit, total: result.total });
  }

  /**
   * Status and audit entry commit together (privilege change - no status
   * change without a record, same reasoning as moderator assignment).
   * Ending sessions runs only after that commits: it's the one step here
   * that's allowed to fail without undoing the moderation action, so it
   * must never be able to swallow the audit write with it.
   */
  async setStatus(
    userId: string,
    toStatus: AdminSettableUserStatus,
    actorId: string,
    reason?: string,
  ) {
    if (userId === actorId) {
      throw new ForbiddenException('You cannot change your own account status');
    }

    const user = await this.usersRepository.findForModeration(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role === UserRole.ADMIN) {
      throw new ForbiddenException("Cannot change another admin's status");
    }

    if (user.status === UserStatus.DELETED) {
      throw new ConflictException('A deleted account cannot be moderated');
    }

    if (user.status === toStatus) {
      throw new ConflictException(`User is already ${toStatus}`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await this.usersRepository.updateStatus(
        tx,
        userId,
        user.status,
        toStatus,
      );

      if (!result) {
        throw new ConflictException(
          'User status changed concurrently, try again',
        );
      }

      await this.auditLogService.recordOrThrow(
        {
          action: AUDIT_ACTION_BY_STATUS[toStatus],
          actorId,
          targetId: userId,
          targetType: 'USER',
          metadata: {
            previousStatus: user.status,
            ...(reason ? { reason } : {}),
          },
        },
        tx,
      );

      return result;
    });

    if (toStatus !== UserStatus.ACTIVE) {
      await this.sessionTerminator.endAllForUser(userId);
    }

    return updated;
  }
}
