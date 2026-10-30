import { encodeCaseCursor, type CaseCursor } from './domain/case-cursor';
import { caseModeratorWhere } from '../common/guards/moderation-capabilities';
import { lockModerationActor } from '../common/moderation/lock-moderation-actor';
import { searchModeratorCandidates } from '../common/moderation/search-moderator-candidates';
import {
  encodeEvidenceCursor,
  type EvidenceCursor,
} from './domain/report-evidence-pagination';
import { projectReportSnapshot } from './domain/report-evidence.projection';
import {
  ConflictException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import {
  Prisma,
  type PostStatus,
  type PostVisibility,
  type ReportReason,
  type ModerationCaseStatus,
  type ReportTargetType,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ReportTargetSnapshot } from './domain/report-target-snapshot';
import { ModerationAnalysisScheduler } from '../moderation-analysis/moderation-analysis-scheduler.service';
import { MODERATION_POLICY_VERSION_V1 } from '../moderation-policy/moderation-policy.types';
import {
  projectAiAdvisory,
  type AdvisoryAnalysisRow,
  type AdvisoryCase,
} from './domain/ai-advisory';

const reportReceiptSelect = {
  id: true,
  caseId: true,
  reporterId: true,
  targetType: true,
  targetId: true,
  reasonCode: true,
  details: true,
  createdAt: true,
} satisfies Prisma.ReportSelect;

// Explicit API projections: adding schema fields cannot expose them through these reads.
const caseSummarySelect = {
  id: true,
  targetType: true,
  targetId: true,
  gameId: true,
  game: { select: { id: true, name: true, slug: true } },
  status: true,
  reportCount: true,
  uniqueReporterCount: true,
  lastReportedAt: true,
  currentRiskScore: true,
  currentRiskLevel: true,
  assignedModeratorId: true,
  assignedModerator: {
    select: { id: true, name: true, image: true, username: true, role: true },
  },
  resolvedById: true,
  resolvedBy: { select: { id: true, name: true, image: true } },
  resolvedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ModerationCaseSelect;

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

type CaseDetail = Prisma.ModerationCaseGetPayload<{
  select: typeof caseSummarySelect & { resolutionNote: true };
}>;

export interface CaseTransitionContext {
  actorId: string;
  caseGameId: string | null;
  // Platform actions omit this predicate; game actions must recheck exact ownership in the write.
  gameId?: string;
  audit: (
    moderationCase: CaseDetail,
    tx: Prisma.TransactionClient,
  ) => Promise<void>;
}

@Injectable()
export class ReportsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analysisScheduler: ModerationAnalysisScheduler,
  ) {}

  /** All response contributors share one PostgreSQL snapshot; writes are prohibited. */
  readSnapshot<T>(
    read: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        return read(tx);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async findLatestAdvisoryAnalyses(
    caseIds: string[],
    db: Prisma.TransactionClient = this.prisma,
  ) {
    if (!caseIds.length) return new Map<string, AdvisoryAnalysisRow>();
    const rows = await db.$queryRaw<AdvisoryAnalysisRow[]>(Prisma.sql`
      SELECT c.id AS "caseId", a.id AS "analysisId", a."targetType" AS "analysisTargetType",
        a."targetId" AS "analysisTargetId", a.generation, a."inputSchemaVersion", a."inputSnapshot",
        a."snapshotHash", a."classifierProfile", a.status AS "analysisStatus", a.result,
        p."policyVersion", p.status AS "policyStatus", p."riskLevel", p."priorityScore", p.signals, p."evaluatedAt"
      FROM moderation_cases c
      LEFT JOIN LATERAL (
        SELECT id, "targetType", "targetId", generation, "inputSchemaVersion", "inputSnapshot",
          "snapshotHash", "classifierProfile", status, result
        FROM moderation_analyses WHERE "caseId" = c.id
        ORDER BY generation DESC LIMIT 1
      ) a ON true
      LEFT JOIN moderation_policy_evaluations p ON p."analysisId" = a.id
        AND p."policyVersion" = ${MODERATION_POLICY_VERSION_V1}
      WHERE c.id IN (${Prisma.join(caseIds)})
    `);
    return new Map(rows.map((row) => [row.caseId, row]));
  }

  async findModerationCases(
    params: {
      gameId?: string | null;
      status?: ModerationCaseStatus;
      view?: 'all' | 'assigned' | 'unassigned' | 'history';
      moderatorId?: string;
      targetType?: ReportTargetType;
      limit: number;
      cursor?: CaseCursor;
    },
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const where: Prisma.ModerationCaseWhereInput = {
      ...((params.view && params.view !== 'all') || params.status === undefined
        ? {
            AND: [
              {
                status: {
                  in:
                    params.view === 'history'
                      ? ['RESOLVED', 'DISMISSED']
                      : ['OPEN', 'IN_REVIEW'],
                },
              },
              ...(params.view === 'assigned'
                ? [{ assignedModeratorId: params.moderatorId }]
                : params.view === 'unassigned'
                  ? [{ assignedModeratorId: null }]
                  : []),
            ],
          }
        : {}),
      ...(params.gameId !== undefined ? { gameId: params.gameId } : {}),
      ...(params.status !== undefined ? { status: params.status } : {}),
      ...(params.targetType !== undefined
        ? { targetType: params.targetType }
        : {}),
      ...(params.cursor
        ? {
            OR: [
              { lastReportedAt: { lt: params.cursor.lastReportedAt } },
              {
                lastReportedAt: params.cursor.lastReportedAt,
                id: { lt: params.cursor.id },
              },
            ],
          }
        : {}),
    };
    const rows = await db.moderationCase.findMany({
      where,
      select: caseSummarySelect,
      orderBy: [{ lastReportedAt: 'desc' }, { id: 'desc' }],
      take: params.limit + 1,
    });
    const page = rows.slice(0, params.limit);
    const last = page.at(-1);
    return {
      items: await this.enrichCasePage(page, db),
      nextCursor:
        rows.length > params.limit && last ? encodeCaseCursor(last) : null,
    };
  }

  /** One aggregation for this bounded set of cases; never fetch complaint bodies. */
  async findCaseReasonSummaries(
    caseIds: string[],
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const result = new Map<
      string,
      Array<{ reasonCode: ReportReason; count: number }>
    >();
    if (!caseIds.length) return result;
    const groups = await db.report.groupBy({
      by: ['caseId', 'reasonCode'],
      where: { caseId: { in: caseIds } },
      _count: { _all: true },
    });
    for (const group of groups) {
      const reasons = result.get(group.caseId) ?? [];
      reasons.push({ reasonCode: group.reasonCode, count: group._count._all });
      result.set(group.caseId, reasons);
    }
    for (const reasons of result.values())
      reasons.sort(
        (a, b) => b.count - a.count || a.reasonCode.localeCompare(b.reasonCode),
      );
    return result;
  }

  private async enrichCasePage<T extends AdvisoryCase>(
    items: T[],
    db: Prisma.TransactionClient,
  ) {
    if (!items.length) return [];
    const postIds = items
      .filter((item) => item.targetType === 'POST')
      .map((item) => item.targetId);
    const commentIds = items
      .filter((item) => item.targetType === 'COMMENT')
      .map((item) => item.targetId);
    // Public previews stay SQL-bounded; private raw text is needed for canonical hashing.
    // The lateral media lookup returns at most one image per post using (postId,sortOrder).
    const [previews, reasons, analyses] = await Promise.all([
      db.$queryRaw<
        Array<{
          targetType: ReportTargetType;
          targetId: string;
          deleted: boolean;
          title: string | null;
          rawTitle: string | null;
          rawContent: string;
          excerpt: string;
          thumbnailUrl: string | null;
          author: {
            id: string;
            name: string;
            username: string | null;
            image: string | null;
          };
        }>
      >(Prisma.sql`
        SELECT 'POST'::text AS "targetType", p.id AS "targetId",
          (p."deletedAt" IS NOT NULL OR p.status = 'DELETED') AS deleted,
          LEFT(NULLIF(BTRIM(p.title), ''), 160) AS title,
          LEFT(regexp_replace(p.content, '\\s+', ' ', 'g'), 240) AS excerpt,
          m.url AS "thumbnailUrl",
          json_build_object('id', u.id, 'name', LEFT(u.name,160), 'username', u.username, 'image', LEFT(u.image,2048)) AS author,
          p.title AS "rawTitle", p.content AS "rawContent"
        FROM posts p JOIN "user" u ON u.id = p."authorId"
        LEFT JOIN LATERAL (SELECT url FROM post_media
          WHERE "postId" = p.id AND "mediaType" = 'IMAGE'
            AND url ~ '^https?://' AND length(url) <= 2048
          ORDER BY "sortOrder", id LIMIT 1) m ON true
        WHERE p.id IN (${Prisma.join(postIds.length ? postIds : [''])})
        UNION ALL
        SELECT 'COMMENT'::text, c.id,
          (c."deletedAt" IS NOT NULL OR p."deletedAt" IS NOT NULL OR p.status = 'DELETED'),
          NULL, LEFT(regexp_replace(c.content, '\\s+', ' ', 'g'), 240), NULL,
          json_build_object('id', u.id, 'name', LEFT(u.name,160), 'username', u.username, 'image', LEFT(u.image,2048)),
          NULL, c.content
        FROM comments c JOIN posts p ON p.id = c."postId" JOIN "user" u ON u.id = c."authorId"
        WHERE c.id IN (${Prisma.join(commentIds.length ? commentIds : [''])})
      `),
      this.findCaseReasonSummaries(
        items.map((item) => item.id),
        db,
      ),
      this.findLatestAdvisoryAnalyses(
        items.map((item) => item.id),
        db,
      ),
    ]);
    const targets = new Map(
      previews.map((row) => [`${row.targetType}:${row.targetId}`, row]),
    );
    return items.map((item) => {
      const row = targets.get(`${item.targetType}:${item.targetId}`);
      const targetState = !row
        ? 'missing'
        : row.deleted
          ? 'deleted'
          : 'available';
      const source = !row
        ? null
        : item.targetType === 'POST'
          ? typeof row.rawTitle === 'string'
            ? {
                targetType: 'POST' as const,
                title: row.rawTitle,
                content: row.rawContent,
              }
            : null
          : { targetType: 'COMMENT' as const, content: row.rawContent };
      return {
        ...item,
        aiAdvisory: projectAiAdvisory(
          item,
          { targetState, source },
          analyses.get(item.id),
        ),
        targetState: !row
          ? ('missing' as const)
          : row.deleted
            ? ('deleted' as const)
            : ('available' as const),
        targetPreview:
          !row || row.deleted
            ? null
            : {
                title: row.title,
                excerpt: row.excerpt,
                thumbnailUrl: row.thumbnailUrl,
                author: row.author,
              },
        reasonSummary: reasons.get(item.id) ?? [],
      };
    });
  }

  findModerationCaseById(
    id: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    return db.moderationCase.findUnique({
      where: { id },
      select: { ...caseSummarySelect, resolutionNote: true },
    });
  }

  async findReportsByCaseId(
    caseId: string,
    limit: number,
    cursor?: EvidenceCursor,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const rows = await db.report.findMany({
      where: {
        caseId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        reporter: { select: { id: true, name: true, image: true } },
        reasonCode: true,
        details: true,
        createdAt: true,
        targetType: true,
        targetId: true,
        targetSnapshot: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        id: row.id,
        reporter: row.reporter,
        reasonCode: row.reasonCode,
        details: row.details,
        createdAt: row.createdAt,
        snapshot: projectReportSnapshot(
          row.targetSnapshot,
          row.targetType,
          row.targetId,
        ),
      })),
      nextCursor:
        rows.length > limit && last ? encodeEvidenceCursor(last) : null,
    };
  }

  async findCaseTarget(
    targetType: ReportTargetType,
    targetId: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    if (targetType === 'POST') {
      const post = await db.post.findUnique({
        where: { id: targetId },
        select: {
          id: true,
          title: true,
          content: true,
          type: true,
          status: true,
          visibility: true,
          deletedAt: true,
          gameId: true,
          createdAt: true,
          updatedAt: true,
          author: { select: { id: true, name: true, image: true } },
          media: {
            take: 20,
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            select: { url: true, mediaType: true, altText: true },
          },
        },
      });
      return {
        target: post ? { targetType: 'POST' as const, ...post } : null,
        targetState: !post
          ? ('missing' as const)
          : post.deletedAt || post.status === 'DELETED'
            ? ('deleted' as const)
            : ('available' as const),
      };
    }
    const comment = await db.comment.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        content: true,
        postId: true,
        parentId: true,
        status: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
        author: { select: { id: true, name: true, image: true } },
        post: {
          select: {
            id: true,
            gameId: true,
            status: true,
            deletedAt: true,
            visibility: true,
            authorId: true,
          },
        },
      },
    });
    return {
      target: comment ? { targetType: 'COMMENT' as const, ...comment } : null,
      targetState: !comment
        ? ('missing' as const)
        : comment.deletedAt ||
            comment.post.deletedAt ||
            comment.post.status === 'DELETED'
          ? ('deleted' as const)
          : ('available' as const),
    };
  }

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
  }) {
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
            // duplicate check and atomic counters across server instances.
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
            select: reportReceiptSelect,
          });
          // Preserve historical totals, including already-deleted reporters. Advance
          // unique reporters once per accepted complaint; never regroup null IDs.
          // The case lock serializes appends; database time tracks report activity.
          await tx.$executeRaw`
            UPDATE "moderation_cases" c SET
              "reportCount" = c."reportCount" + 1,
              "uniqueReporterCount" = c."uniqueReporterCount" + 1,
              "lastReportedAt" = GREATEST(c."lastReportedAt", clock_timestamp() AT TIME ZONE 'UTC'),
              "updatedAt" = clock_timestamp() AT TIME ZONE 'UTC'
            WHERE c.id = ${moderationCase.id}
          `;
          await this.analysisScheduler.scheduleIfNeeded(tx, {
            caseId: moderationCase.id,
            sourceReportId: report.id,
            targetType: params.targetType,
            targetId: params.targetId,
            snapshot: params.snapshot,
          });
          return report;
        });
        if (result) return result;
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

  async countActiveCases() {
    const where = { status: { in: [...OPEN_CASE_STATUSES] } };
    const [openCases, unassignedCases] = await Promise.all([
      this.prisma.moderationCase.count({ where }),
      this.prisma.moderationCase.count({
        where: { ...where, assignedModeratorId: null },
      }),
    ]);
    return { openCases, unassignedCases };
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

    // Dashboard metric counts surviving complaints, not workflow resources.
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

  searchAssignees(gameId: string | null, query: string) {
    return searchModeratorCandidates(
      this.prisma,
      caseModeratorWhere(gameId),
      query,
    );
  }

  assignCase(
    caseId: string,
    assigneeId: string,
    context: CaseTransitionContext,
  ) {
    return this.transitionCase(
      caseId,
      context,
      {
        status: 'IN_REVIEW',
        assignedModeratorId: assigneeId,
      },
      OPEN_CASE_STATUSES,
      assigneeId,
    );
  }

  async claimCase(
    caseId: string,
    moderatorId: string,
    context: CaseTransitionContext,
  ): Promise<CaseDetail | null> {
    return this.transitionCase(
      caseId,
      context,
      {
        status: 'IN_REVIEW',
        assignedModeratorId: moderatorId,
      },
      ['OPEN'],
    );
  }

  async finalizeCase(
    params: {
      id: string;
      status: 'RESOLVED' | 'DISMISSED';
      resolvedById: string;
      resolutionNote?: string;
    },
    context: CaseTransitionContext,
  ): Promise<CaseDetail | null> {
    return this.transitionCase(
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

  private async transitionCase(
    caseId: string,
    context: CaseTransitionContext,
    data: Prisma.ModerationCaseUncheckedUpdateManyInput,
    statuses: readonly ModerationCaseStatus[],
    assigneeId?: string,
  ): Promise<CaseDetail | null> {
    return this.prisma.$transaction(async (tx) => {
      await lockModerationActor(
        tx,
        context.actorId,
        context.gameId,
        assigneeId,
      );
      if (assigneeId !== undefined) {
        if (context.caseGameId !== null) {
          await tx.$queryRaw`SELECT id FROM game_moderators
            WHERE "userId" = ${assigneeId} AND "gameId" = ${context.caseGameId} FOR SHARE`;
        }
        const eligible = await tx.user.findFirst({
          where: { id: assigneeId, ...caseModeratorWhere(context.caseGameId) },
          select: { id: true },
        });
        if (!eligible)
          throw new BadRequestException(
            'Choose an active moderator eligible for this case',
          );
      }

      // PostgreSQL rechecks status and game ownership after competing writers finish.
      const { count } = await tx.moderationCase.updateMany({
        where: {
          id: caseId,
          gameId: context.caseGameId,
          ...(context.gameId !== undefined ? { gameId: context.gameId } : {}),
          status: { in: [...statuses] },
        },
        data,
      });
      if (count === 0) return null;
      const result = await tx.moderationCase.findUniqueOrThrow({
        where: { id: caseId },
        select: { ...caseSummarySelect, resolutionNote: true },
      });
      await context.audit(result, tx);
      return result;
    });
  }
}
