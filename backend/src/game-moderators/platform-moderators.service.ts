import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { loadActiveUser } from '../common/guards/active-user.util';
import { releaseModeratorCases } from '../common/moderation/release-moderator-cases';
import { searchModeratorCandidates } from '../common/moderation/search-moderator-candidates';

@Injectable()
export class PlatformModeratorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async search(actorId: string, q = '') {
    const actor = await loadActiveUser(this.prisma, actorId);
    if (actor.role !== 'ADMIN')
      throw new ForbiddenException('Admin permission required');
    return {
      items: await searchModeratorCandidates(
        this.prisma,
        { status: 'ACTIVE', role: { in: ['USER', 'PLATFORM_MODERATOR'] } },
        q,
      ),
    };
  }

  async change(actorId: string, targetId: string, grant: boolean) {
    return this.prisma.$transaction(async (tx) => {
      // Keep the live actor's authorization stable until the audited mutation commits.
      await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${actorId} FOR SHARE`;
      const actor = await tx.user.findUnique({
        where: { id: actorId },
        select: { role: true, status: true },
      });
      if (!actor || actor.status !== 'ACTIVE' || actor.role !== 'ADMIN')
        throw new ForbiddenException('Active admin permission required');
      if (actorId === targetId)
        throw new BadRequestException('Admin roles cannot be changed here');
      await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${targetId} FOR UPDATE`;
      const target = await tx.user.findUnique({
        where: { id: targetId },
        select: { id: true, role: true, status: true },
      });
      if (!target) throw new NotFoundException('User not found');
      if (target.role === 'ADMIN')
        throw new BadRequestException('Admin roles cannot be changed here');
      if (target.status !== 'ACTIVE')
        throw new BadRequestException(
          'Only active users can change moderator access',
        );
      const previousRole = grant ? 'USER' : 'PLATFORM_MODERATOR';
      const newRole = grant ? 'PLATFORM_MODERATOR' : 'USER';
      if (target.role !== previousRole)
        throw new ConflictException(
          'This user already has the requested access',
        );
      const changed = await tx.user.updateMany({
        where: { id: targetId, role: previousRole, status: 'ACTIVE' },
        data: { role: newRole },
      });
      if (changed.count !== 1)
        throw new ConflictException('User access changed; search again');
      if (!grant) {
        // Cases in games they still moderate stay theirs
        const games = await tx.gameModerator.findMany({
          where: { userId: targetId },
          select: { gameId: true },
        });
        await releaseModeratorCases(tx, targetId, {
          OR: [
            { gameId: null },
            { gameId: { notIn: games.map((game) => game.gameId) } },
          ],
        });
      }
      await this.audit.recordOrThrow(
        {
          action: grant ? 'MODERATOR_ASSIGNED' : 'MODERATOR_REMOVED',
          actorId,
          targetType: 'USER',
          targetId,
          metadata: { scope: 'platform', previousRole, newRole },
        },
        tx,
      );
      return { id: targetId, role: newRole };
    });
  }
}
