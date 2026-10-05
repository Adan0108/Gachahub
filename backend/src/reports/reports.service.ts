import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ReportTargetType } from '../generated/prisma/client';
import { loadActiveUser } from '../common/guards/active-user.util';
import { normalizeText } from '../common/utils/normalize-text';
import { PostVisibilityService } from '../post-visibility/post-visibility.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportRateLimiterService } from './report-rate-limiter.service';
import { ReportsRepository } from './reports.repository';

/**
 * Filing a report. Split from the moderation queue (ReportModerationService)
 * the same way PostsService/PostModerationService are - this only needs
 * PostVisibilityService, the rate limiter, and an active-user check, none of
 * which the moderation queue uses; the queue only needs
 * GameModeratorsService, which filing never touches.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly reportsRepository: ReportsRepository,
    private readonly postVisibility: PostVisibilityService,
    private readonly reportRateLimiter: ReportRateLimiterService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Files a report against a post or comment.
   *
   * Enforces both halves of "any active user can report anything they can
   * see": the reporter's account must be ACTIVE (a banned account with a
   * still-live session cannot file reports), and the target must actually be
   * visible to them under the platform's one shared visibility rule.
   */
  async create(reporterId: string, dto: CreateReportDto) {
    this.reportRateLimiter.assertNotRateLimited(reporterId);

    await loadActiveUser(this.prisma, reporterId);

    const gameId = await this.assertReportableTarget(
      dto.targetType,
      dto.targetId,
      reporterId,
    );

    const hasOpenReport = await this.reportsRepository.hasOpenReport(
      reporterId,
      dto.targetType,
      dto.targetId,
    );

    if (hasOpenReport) {
      throw new ConflictException(
        'You already have an open report on this content',
      );
    }

    return this.reportsRepository.create({
      gameId,
      reporterId,
      targetType: dto.targetType,
      targetId: dto.targetId,
      reasonCode: dto.reasonCode,
      details: normalizeText(dto.details),
    });
  }

  /**
   * Resolves a report target to its game, after checking the reporter could
   * actually see it - a comment target inherits its parent post's
   * visibility, since a comment can't be more visible than the post it's on.
   */
  private async assertReportableTarget(
    targetType: ReportTargetType,
    targetId: string,
    reporterId: string,
  ): Promise<string> {
    const target = await this.reportsRepository.findTargetPostInfo(
      targetType,
      targetId,
    );

    if (!target || !(await this.postVisibility.canView(target, reporterId))) {
      throw new NotFoundException('Reported content not found');
    }

    return target.gameId;
  }
}
