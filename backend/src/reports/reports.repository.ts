import { ConflictException, Injectable } from '@nestjs/common';
import {
  Prisma,
  type PostStatus,
  type PostVisibility,
  type ReportReason,
  type ReportStatus,
  type ReportTargetType,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const reportInclude = {
  reporter: {
    select: { id: true, name: true, image: true },
  },
  assignedModerator: {
    select: { id: true, name: true, image: true },
  },
  resolvedBy: {
    select: { id: true, name: true, image: true },
  },
} satisfies Prisma.ReportInclude;

export interface ReportableTargetInfo {
  gameId: string;
  deletedAt: Date | null;
  status: PostStatus;
  visibility: PostVisibility;
  authorId: string;
}

const OPEN_REPORT_STATUSES: ReportStatus[] = ['PENDING', 'IN_REVIEW'];

@Injectable()
export class ReportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves a report target down to the post-level fields ReportsService
   * needs to decide whether the reporter could actually see it - a comment
   * target folds in through its parent post, since a comment's visibility is
   * entirely inherited from the post it's on. This is a pure data lookup;
   * ReportsService owns the actual viewability decision.
   */
  async findTargetPostInfo(
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<ReportableTargetInfo | null> {
    if (targetType === 'POST') {
      return this.prisma.post.findUnique({
        where: { id: targetId },
        select: {
          gameId: true,
          deletedAt: true,
          status: true,
          visibility: true,
          authorId: true,
        },
      });
    }

    const comment = await this.prisma.comment.findUnique({
      where: { id: targetId },
      select: {
        deletedAt: true,
        post: {
          select: {
            gameId: true,
            deletedAt: true,
            status: true,
            visibility: true,
            authorId: true,
          },
        },
      },
    });

    if (!comment || comment.deletedAt) {
      return null;
    }

    return comment.post;
  }

  /**
   * True when this reporter already has an unresolved report on this exact
   * target. Used instead of a DB unique constraint so a report can be
   * re-filed once an earlier one closes - see the schema comment on Report.
   */
  async hasOpenReport(
    reporterId: string,
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<boolean> {
    const existing = await this.prisma.report.findFirst({
      where: {
        reporterId,
        targetType,
        targetId,
        status: { in: OPEN_REPORT_STATUSES },
      },
      select: { id: true },
    });

    return existing !== null;
  }

  /**
   * hasOpenReport() is the fast, friendly pre-check; the real guarantee
   * against two concurrent requests both passing that check is the hand-
   * written partial unique index "reports_open_target_key" (see the Report
   * model's schema comment). Postgres reports a violation of it the same way
   * as any other unique constraint, so it surfaces here as an ordinary P2002.
   */
  async create(params: {
    gameId: string;
    reporterId: string;
    targetType: ReportTargetType;
    targetId: string;
    reasonCode: ReportReason;
    details?: string;
  }) {
    try {
      return await this.prisma.report.create({
        data: params,
        include: reportInclude,
      });
    } catch (error) {
      if (this.isDuplicateOpenReport(error)) {
        throw new ConflictException(
          'You already have an open report on this content',
        );
      }
      throw error;
    }
  }

  private isDuplicateOpenReport(
    error: unknown,
  ): error is Prisma.PrismaClientKnownRequestError {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  findById(id: string) {
    return this.prisma.report.findUnique({
      where: { id },
      include: reportInclude,
    });
  }

  async findMany(params: {
    gameId?: string;
    status?: ReportStatus;
    targetType?: ReportTargetType;
    page: number;
    limit: number;
  }) {
    const where: Prisma.ReportWhereInput = {
      ...(params.gameId ? { gameId: params.gameId } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.targetType ? { targetType: params.targetType } : {}),
    };

    const skip = (params.page - 1) * params.limit;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.report.findMany({
        where,
        include: reportInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: params.limit,
      }),
      this.prisma.report.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * Claims a report only if it's still PENDING when the write happens -
   * unlike a plain update, which would let two moderators clicking Claim at
   * the same time both "succeed", with the second silently overwriting the
   * first's assignedModeratorId. Returns null when someone else already
   * claimed it, mirroring PostsRepository.transitionStatus.
   */
  claim(id: string, moderatorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.report.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'IN_REVIEW', assignedModeratorId: moderatorId },
      });

      if (result.count === 0) {
        return null;
      }

      return tx.report.findUniqueOrThrow({
        where: { id },
        include: reportInclude,
      });
    });
  }

  /**
   * Same conditional-write shape as claim() - only closes a report that's
   * still open when the write happens, so two moderators resolving the same
   * report at once can't silently clobber each other's resolutionNote.
   */
  finalize(params: {
    id: string;
    status: 'RESOLVED' | 'DISMISSED';
    resolvedById: string;
    resolutionNote?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.report.updateMany({
        where: { id: params.id, status: { in: OPEN_REPORT_STATUSES } },
        data: {
          status: params.status,
          resolvedById: params.resolvedById,
          resolutionNote: params.resolutionNote,
          resolvedAt: new Date(),
        },
      });

      if (result.count === 0) {
        return null;
      }

      return tx.report.findUniqueOrThrow({
        where: { id: params.id },
        include: reportInclude,
      });
    });
  }
}
