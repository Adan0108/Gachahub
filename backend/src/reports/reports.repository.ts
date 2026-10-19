import { ConflictException, Injectable } from '@nestjs/common';
import {
  Prisma,
  type PostStatus,
  type PostVisibility,
  type ReportReason,
  type ModerationCaseStatus,
  type ReportTargetType,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  type LegacyReportStatus,
  toCaseStatus,
} from './domain/report-status.compat';
import type { ReportTargetSnapshot } from './domain/report-target-snapshot';

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
  snapshot: ReportTargetSnapshot;
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
function toLegacyReport({
  case: moderationCase,
  targetSnapshot: _evidence,
  ...report
}: ReportWithCase) {
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

export interface CaseTransitionContext {
  gameId: string;
  audit: (report: LegacyReport, tx: Prisma.TransactionClient) => Promise<void>;
}

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
      const post = await this.prisma.post.findUnique({
        where: { id: targetId },
        select: {
          gameId: true,
          deletedAt: true,
          status: true,
          visibility: true,
          authorId: true,
          id: true,
          title: true,
          content: true,
          type: true,
          categoryId: true,
          media: {
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              mediaUploadId: true,
              mediaType: true,
              url: true,
              assetId: true,
              publicId: true,
              altText: true,
              sortOrder: true,
              width: true,
              height: true,
              duration: true,
              bytes: true,
              format: true,
            },
          },
        },
      });
      if (!post) return null;
      const { id, deletedAt: _deletedAt, ...evidence } = post;
      return {
        gameId: post.gameId,
        deletedAt: post.deletedAt,
        status: post.status,
        visibility: post.visibility,
        authorId: post.authorId,
        snapshot: { ...evidence, version: 1, targetType: 'POST', postId: id },
      };
    }

    const comment = await this.prisma.comment.findUnique({
      where: { id: targetId },
      select: {
        deletedAt: true,
        status: true,
        id: true,
        authorId: true,
        content: true,
        postId: true,
        parentId: true,
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

    return {
      ...comment.post,
      snapshot: {
        version: 1,
        targetType: 'COMMENT',
        commentId: comment.id,
        authorId: comment.authorId,
        content: comment.content,
        status: comment.status,
        postId: comment.postId,
        parentId: comment.parentId,
        gameId: comment.post.gameId,
      },
    };
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

  async create(params: {
    gameId: string | null;
    reporterId: string;
    targetType: ReportTargetType;
    targetId: string;
    reasonCode: ReportReason;
    details?: string;
    snapshot: ReportTargetSnapshot;
  }): Promise<LegacyReport> {
    // A PostgreSQL unique violation aborts its transaction: recovery must use
    // a fresh transaction, never another query in the failed transaction.
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const result = await this.prisma.$transaction(async (tx) => {
          let moderationCase = await tx.moderationCase.findFirst({
            where: {
              targetType: params.targetType,
              targetId: params.targetId,
              status: { in: OPEN_CASE_STATUSES },
            },
          });
          if (moderationCase) {
            // Serialize reporters of an existing case. This also protects the
            // duplicate check and recomputed counters across server instances.
            const locked = await tx.$queryRaw<Array<{ id: string }>>`
              SELECT "id" FROM "moderation_cases"
              WHERE "id" = ${moderationCase.id}
              AND "status" IN ('OPEN', 'IN_REVIEW') FOR UPDATE
            `;
            if (locked.length === 0) return null; // closed while waiting: retry
          } else {
            // The partial unique index arbitrates simultaneous first reports.
            moderationCase = await tx.moderationCase.create({
              data: {
                targetType: params.targetType,
                targetId: params.targetId,
                gameId: params.gameId,
                status: 'OPEN',
              },
            });
          }
          const duplicate = await tx.report.findFirst({
            where: { caseId: moderationCase.id, reporterId: params.reporterId },
            select: { id: true },
          });
          if (duplicate)
            throw new ConflictException(
              'You already have an open report on this content',
            );
          const report = await tx.report.create({
            data: {
              caseId: moderationCase.id,
              reporterId: params.reporterId,
              targetType: params.targetType,
              targetId: params.targetId,
              reasonCode: params.reasonCode,
              details: params.details,
              targetSnapshot: params.snapshot,
            },
          });
          const reportCount = await tx.report.count({
            where: { caseId: moderationCase.id },
          });
          const reporters = await tx.report.findMany({
            where: { caseId: moderationCase.id },
            distinct: ['reporterId'],
            select: { reporterId: true },
          });
          await tx.moderationCase.update({
            where: { id: moderationCase.id },
            data: { reportCount, uniqueReporterCount: reporters.length },
          });
          return tx.report.findUniqueOrThrow({
            where: { id: report.id },
            include: reportInclude,
          });
        });
        if (result) return toLegacyReport(result);
      } catch (error) {
        if (
          !(
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          )
        )
          throw error;
      }
    }
    throw new ConflictException('The moderation case changed; please retry');
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

  // undefined: all cases; null: platform cases; string: one game.
  async findMany(params: {
    gameId?: string | null;
    status?: LegacyReportStatus;
    targetType?: ReportTargetType;
    page: number;
    limit: number;
  }) {
    const where: Prisma.ReportWhereInput = {
      case: {
        ...(params.gameId !== undefined ? { gameId: params.gameId } : {}),
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

  async claim(
    id: string,
    moderatorId: string,
    context: CaseTransitionContext,
  ): Promise<LegacyReport | null> {
    return this.transition(
      id,
      context,
      {
        status: 'IN_REVIEW',
        assignedModeratorId: moderatorId,
      },
      ['OPEN'],
    );
  }

  async finalize(
    params: {
      id: string;
      status: 'RESOLVED' | 'DISMISSED';
      resolvedById: string;
      resolutionNote?: string;
    },
    context: CaseTransitionContext,
  ): Promise<LegacyReport | null> {
    return this.transition(
      params.id,
      context,
      {
        status: params.status,
        resolvedById: params.resolvedById,
        resolvedAt: new Date(),
        resolutionNote: params.resolutionNote ?? null,
      },
      OPEN_CASE_STATUSES,
    );
  }

  private async transition(
    reportId: string,
    context: CaseTransitionContext,
    data: Prisma.ModerationCaseUncheckedUpdateManyInput,
    statuses: readonly ModerationCaseStatus[],
  ): Promise<LegacyReport | null> {
    return this.prisma.$transaction(async (tx) => {
      const report = await tx.report.findUnique({
        where: { id: reportId },
        select: { caseId: true },
      });
      if (!report) return null;
      // PostgreSQL rechecks this predicate after waiting for a competing
      // writer. Scope is checked again here so a deleted game cannot turn
      // an authorized game action into an action on a platform case.
      const { count } = await tx.moderationCase.updateMany({
        where: {
          id: report.caseId,
          gameId: context.gameId,
          status: { in: [...statuses] },
        },
        data,
      });
      if (count === 0) return null;
      const result = toLegacyReport(
        await tx.report.findUniqueOrThrow({
          where: { id: reportId },
          include: reportInclude,
        }),
      );
      await context.audit(result, tx);
      return result;
    });
  }
}
