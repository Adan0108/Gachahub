import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  Prisma,
  type PostStatus,
  type PostVisibility,
  type ReportReason,
  type ModerationCaseStatus,
  type ReportTargetType,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { type LegacyReportStatus, toCaseStatus } from './report-status.compat';

const reportInclude = {
  reporter: {
    select: { id: true, name: true, image: true },
  },
  case: {
    include: {
      assignedModerator: { select: { id: true, name: true, image: true } },
      resolvedBy: { select: { id: true, name: true, image: true } },
      game: { select: { id: true, name: true, slug: true } },
    },
  },
} satisfies Prisma.ReportInclude;

export interface ReportableTargetInfo {
  gameId: string | null;
  deletedAt: Date | null;
  status: PostStatus;
  visibility: PostVisibility;
  authorId: string;
}

const OPEN_CASE_STATUSES = [
  'OPEN',
  'IN_REVIEW',
] as const satisfies ModerationCaseStatus[];

type ReportWithCase = Prisma.ReportGetPayload<{
  include: typeof reportInclude;
}>;

// TODO(Stage 3): retire this projection when the existing report APIs are
// replaced with case APIs. It preserves their flat response fields for now.
function toLegacyReport({ case: moderationCase, ...report }: ReportWithCase) {
  return {
    ...report,
    gameId: moderationCase.gameId,
    game: moderationCase.game,
    status:
      moderationCase.status === 'OPEN'
        ? ('PENDING' as const)
        : moderationCase.status,
    assignedModeratorId: moderationCase.assignedModeratorId,
    assignedModerator: moderationCase.assignedModerator,
    resolutionNote: moderationCase.resolutionNote,
    resolvedById: moderationCase.resolvedById,
    resolvedBy: moderationCase.resolvedBy,
    resolvedAt: moderationCase.resolvedAt,
    updatedAt: moderationCase.updatedAt,
  };
}

type LegacyReport = ReturnType<typeof toLegacyReport>;

@Injectable()
export class ReportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves a report target down to the post-level fields ReportsService
   * needs to decide whether the reporter could actually see it. A comment
   * target folds in its parent post's fields - a comment inherits the
   * post's PUBLIC/FOLLOWERS_ONLY/PRIVATE visibility - but a comment also
   * carries its own moderation status now, so a HIDDEN comment is treated
   * as not found here the same way a deleted one is, independent of
   * whatever its post's status says. This is a pure data lookup;
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
        status: true,
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

    if (!comment || comment.deletedAt || comment.status === 'HIDDEN') {
      return null;
    }

    return comment.post;
  }

  /** Read-only duplicate pre-check against the report's case workflow. */
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
        case: { status: { in: OPEN_CASE_STATUSES } },
      },
      select: { id: true },
    });

    return existing !== null;
  }

  // TODO(Stage 2): implement case attachment, immutable evidence and the
  // report-creation transaction. The old insert cannot satisfy required caseId.
  async create(_params: {
    gameId: string | null;
    reporterId: string;
    targetType: ReportTargetType;
    targetId: string;
    reasonCode: ReportReason;
    details?: string;
  }): Promise<LegacyReport> {
    throw new NotImplementedException(
      'Report creation is pending the case-based implementation',
    );
  }

  async findById(id: string) {
    const report = await this.prisma.report.findUnique({
      where: { id },
      include: reportInclude,
    });
    return report ? toLegacyReport(report) : null;
  }

  /**
   * Open report count per target, across every game - scoped to
   * OPEN/IN_REVIEW so a target stops showing up once its reports are all
   * resolved or dismissed, the same way it drops out of the per-game report
   * queue. Without this the aggregate grows with all report history ever
   * filed instead of staying bounded by what's actually outstanding, which
   * is also what keeps this query small enough for ContentModerationService
   * to page through in memory (see its own docblock).
   *
   * Prisma can't join a polymorphic targetId against Post/Comment directly,
   * so ContentModerationService hydrates these ids against those tables
   * itself once it knows which page of targets it needs.
   */
  async countAllByTarget() {
    const groups = await this.prisma.report.groupBy({
      by: ['targetType', 'targetId'],
      where: { case: { status: { in: OPEN_CASE_STATUSES } } },
      _count: { _all: true },
    });

    return groups.map((group) => ({
      targetType: group.targetType,
      targetId: group.targetId,
      count: group._count._all,
    }));
  }

  /** Total open (OPEN/IN_REVIEW) reports across every game - the admin dashboard's metric. */
  countOpen() {
    return this.prisma.report.count({
      where: { case: { status: { in: OPEN_CASE_STATUSES } } },
    });
  }

  /**
   * Open report count per game, scoped to the given game ids - used by the
   * admin dashboard to annotate its communities snapshot. Takes the ids the
   * caller already needs the count for, rather than every game, so this
   * stays cheap regardless of how many games exist.
   */
  async countOpenByGameIds(gameIds: string[]) {
    if (gameIds.length === 0) {
      return [];
    }

    // Compatibility read: count individual complaints, not case rows or
    // the aggregate counters that will be maintained in a later stage.
    const cases = await this.prisma.moderationCase.findMany({
      where: { status: { in: OPEN_CASE_STATUSES }, gameId: { in: gameIds } },
      select: { gameId: true, _count: { select: { reports: true } } },
    });
    const counts = new Map<string, number>();
    for (const entry of cases) {
      if (entry.gameId !== null && entry._count.reports > 0) {
        counts.set(
          entry.gameId,
          (counts.get(entry.gameId) ?? 0) + entry._count.reports,
        );
      }
    }
    return Array.from(counts, ([gameId, count]) => ({ gameId, count }));
  }

  async findMany(params: {
    gameId?: string;
    status?: LegacyReportStatus;
    targetType?: ReportTargetType;
    page: number;
    limit: number;
  }) {
    const where: Prisma.ReportWhereInput = {
      case: {
        ...(params.gameId ? { gameId: params.gameId } : {}),
        ...(params.status ? { status: toCaseStatus(params.status) } : {}),
      },
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

    return { items: items.map(toLegacyReport), total };
  }

  // TODO(Stage 3): design case-scoped moderation writes and audit semantics.
  // Updating a case here would silently resolve/claim every sibling report.
  async claim(_id: string, _moderatorId: string): Promise<LegacyReport | null> {
    throw new NotImplementedException(
      'Report claiming is pending case-based moderation',
    );
  }

  async finalize(_params: {
    id: string;
    status: 'RESOLVED' | 'DISMISSED';
    resolvedById: string;
    resolutionNote?: string;
  }): Promise<LegacyReport | null> {
    throw new NotImplementedException(
      'Report resolution is pending case-based moderation',
    );
  }
}
