import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole, UserStatus } from '../generated/prisma/client';
import { QueryUsersAdminDto } from './dto/query-users-admin.dto';
import { UsersRepository } from './users.repository';
import { resolvePagination, toPaginated } from '../common/utils/paginated';

/** Lists preserved legacy states and supports audited reactivation only. */
@Injectable()
export class UserModerationService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly auditLogService: AuditLogService,
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

  /** Legacy reactivation and audit commit together. Temporary sanctions remain separate. */
  async setStatus(
    userId: string,
    toStatus: UserStatus,
    actorId: string,
    reason?: string,
  ) {
    if (userId === actorId) {
      throw new ForbiddenException('You cannot change your own account status');
    }

    if (toStatus !== UserStatus.ACTIVE)
      throw new BadRequestException(
        'MVP restrictions must use an explicit temporary case sanction of 1-30 days',
      );

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
          action: 'USER_REACTIVATED',
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

    return updated;
  }
}
