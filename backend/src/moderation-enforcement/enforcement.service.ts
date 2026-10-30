import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, type EnforcementScope } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxEventPublisher } from '../outbox/outbox-event.publisher';
import { lockModerationActor } from '../common/moderation/lock-moderation-actor';
import { PostsRepository } from '../posts/posts.repository';
import { CommentsRepository } from '../comments/comments.repository';
import { releaseModeratorCases } from '../common/moderation/release-moderator-cases';
import {
  computeUserRisk,
  durationPolicy,
  riskPolicy,
  sanctionExpiry,
} from './risk-policy';
import type {
  AdjustSanctionDto,
  ConfirmViolationDto,
  ReviewAppealDto,
  SanctionDto,
} from './enforcement.dto';

type Tx = Prisma.TransactionClient;
type Context = {
  scope: EnforcementScope;
  gameId: string | null;
  actor: { id: string; role: string };
};
const PUBLIC_SANCTION = {
  id: true,
  type: true,
  scope: true,
  gameId: true,
  caseId: true,
  violationId: true,
  enforcementId: true,
  subjectId: true,
  reason: true,
  startsAt: true,
  expiresAt: true,
  status: true,
  revokedAt: true,
  createdAt: true,
  game: { select: { name: true, slug: true } },
  appeal: {
    select: {
      id: true,
      statement: true,
      status: true,
      decisionReason: true,
      reviewedAt: true,
      createdAt: true,
    },
  },
} satisfies Prisma.ModerationSanctionSelect;

@Injectable()
export class EnforcementService {
  constructor(
    private readonly db: PrismaService,
    private readonly events: OutboxEventPublisher,
    private readonly posts: PostsRepository,
    private readonly comments: CommentsRepository,
  ) {
    durationPolicy();
    riskPolicy(); // Invalid operational policy must fail startup, rather than silently change risk.
  }
  private publicViolation<T extends { incidentKey: string }>(row: T) {
    const { incidentKey: _incidentKey, ...result } = row;
    return result;
  }
  private reason(value: string) {
    const text = value.trim();
    if (text.length < 3 || text.length > 1000)
      throw new BadRequestException(
        'Give a reason between 3 and 1000 characters',
      );
    return text;
  }
  async context(tx: Tx, actorId: string, gameSlug?: string): Promise<Context> {
    const game = gameSlug
      ? await tx.game.findUnique({
          where: { slug: gameSlug },
          select: { id: true },
        })
      : null;
    if (gameSlug && !game) throw new NotFoundException('Community not found');
    await lockModerationActor(tx, actorId, game?.id);
    const actor = await tx.user.findUniqueOrThrow({
      where: { id: actorId },
      select: { id: true, role: true },
    });
    if (!game && !['ADMIN', 'PLATFORM_MODERATOR'].includes(actor.role))
      throw new ForbiddenException('Platform moderation permission required');
    const blocked = await tx.moderationSanction.count({
      where: {
        subjectId: actorId,
        type: { not: 'WARNING' },
        status: 'ACTIVE',
        startsAt: { lte: new Date() },
        AND: [
          {
            OR: [
              { scope: 'PLATFORM' },
              ...(game
                ? [{ scope: 'COMMUNITY' as const, gameId: game.id }]
                : []),
            ],
          },
          { expiresAt: { gt: new Date() } },
        ],
      },
    });
    if (blocked)
      throw new ForbiddenException(
        'Your account cannot perform moderation actions',
      );
    return {
      actor,
      scope: game ? 'COMMUNITY' : 'PLATFORM',
      gameId: game?.id ?? null,
    };
  }
  private async subject(tx: Tx, context: Context, subjectId: string) {
    if (subjectId === context.actor.id)
      throw new ForbiddenException('You cannot sanction yourself');
    await tx.$queryRaw`SELECT id FROM "user" WHERE id=${subjectId} FOR SHARE`;
    const user = await tx.user.findUnique({
      where: { id: subjectId },
      select: {
        role: true,
        status: true,
        moderatedGames: { take: 1, select: { id: true } },
      },
    });
    if (!user || user.status === 'DELETED')
      throw new NotFoundException('Account unavailable');
    if (
      user.role === 'ADMIN' ||
      (context.actor.role !== 'ADMIN' &&
        (user.role !== 'USER' || user.moderatedGames.length))
    )
      throw new ForbiddenException(
        'A more privileged staff member must review this account',
      );
  }
  private async lockSubject(tx: Tx, id: string) {
    // Serializes sanctions, appeals and violation decisions for one account without table locks.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`moderation:${id}`}, 0))::text`;
  }
  private async caseTarget(tx: Tx, caseId: string, context: Context) {
    await tx.$queryRaw`SELECT id FROM moderation_cases WHERE id=${caseId} FOR SHARE`;
    const item = await tx.moderationCase.findUnique({ where: { id: caseId } });
    if (
      !item ||
      (context.scope === 'COMMUNITY' && item.gameId !== context.gameId)
    )
      throw new NotFoundException('Case unavailable in this workspace');
    const target =
      item.targetType === 'POST'
        ? await tx.post.findUnique({
            where: { id: item.targetId },
            select: {
              id: true,
              authorId: true,
              status: true,
              deletedAt: true,
              gameId: true,
              title: true,
              content: true,
            },
          })
        : await tx.comment.findUnique({
            where: { id: item.targetId },
            select: {
              id: true,
              authorId: true,
              status: true,
              deletedAt: true,
              content: true,
              post: { select: { gameId: true } },
            },
          });
    if (!target) throw new NotFoundException('Content unavailable');
    const gameId = 'gameId' in target ? target.gameId : target.post.gameId;
    if (item.gameId !== gameId)
      throw new ConflictException('Case scope no longer matches the content');
    return { item, target, gameId };
  }
  async audit(
    tx: Tx,
    actorId: string | null,
    action: string,
    entityId: string,
    reason: string,
    before: Prisma.InputJsonValue,
    after: Prisma.InputJsonValue,
  ) {
    await tx.moderationDecisionAudit.create({
      data: {
        actorId,
        action,
        entityId,
        reason,
        previousState: before,
        resultingState: after,
      },
    });
  }
  async notice(
    tx: Tx,
    recipientId: string,
    actorId: string | null,
    entityId: string,
  ) {
    await this.events.publish(
      {
        type: 'moderation.notice',
        aggregateId: entityId,
        payload: { recipientId, actorId, entityId },
      },
      tx,
    );
  }
  async content(
    actorId: string,
    targetType: 'POST' | 'COMMENT',
    targetId: string,
    hidden: boolean,
    reason: string,
    gameSlug?: string,
    caseId?: string,
  ) {
    reason = this.reason(reason);
    return this.db.$transaction(async (tx) =>
      this.contentInTransaction(
        tx,
        await this.context(tx, actorId, gameSlug),
        actorId,
        targetType,
        targetId,
        hidden,
        reason,
        caseId,
      ),
    );
  }
  private async contentInTransaction(
    tx: Tx,
    context: Context,
    actorId: string,
    targetType: 'POST' | 'COMMENT',
    targetId: string,
    hidden: boolean,
    reason: string,
    caseId?: string,
  ) {
    // Content row locks also serialize against author deletion and other visibility changes.
    if (targetType === 'POST')
      await tx.$queryRaw`SELECT id FROM posts WHERE id=${targetId} FOR UPDATE`;
    else
      await tx.$queryRaw`SELECT id FROM comments WHERE id=${targetId} FOR UPDATE`;
    const target =
      targetType === 'POST'
        ? await tx.post.findUnique({
            where: { id: targetId },
            select: {
              authorId: true,
              status: true,
              deletedAt: true,
              gameId: true,
            },
          })
        : await tx.comment.findUnique({
            where: { id: targetId },
            select: {
              authorId: true,
              status: true,
              deletedAt: true,
              postId: true,
              post: { select: { gameId: true } },
            },
          });
    if (!target || target.deletedAt || target.status === 'DELETED')
      throw new NotFoundException(
        'Deleted content cannot be restored or moderated',
      );
    const gameId = 'gameId' in target ? target.gameId : target.post.gameId;
    if (context.scope === 'COMMUNITY' && gameId !== context.gameId)
      throw new NotFoundException('Content unavailable in this community');
    if (caseId) {
      const item = await tx.moderationCase.findUnique({
        where: { id: caseId },
      });
      if (
        !item ||
        item.targetType !== targetType ||
        item.targetId !== targetId ||
        item.gameId !== gameId
      )
        throw new BadRequestException('Case does not match the target');
    }
    const active = await tx.contentEnforcement.findMany({
      where: { targetType, targetId, revokedAt: null },
    });
    if (hidden) {
      if (!['PUBLISHED', 'HIDDEN'].includes(target.status))
        throw new BadRequestException(
          'Only published or already hidden content is eligible',
        );
      if (!active.some((record) => record.scope === context.scope)) {
        const record = await tx.contentEnforcement.create({
          data: {
            targetType,
            targetId,
            subjectId: target.authorId,
            actorId,
            scope: context.scope,
            gameId,
            caseId,
            reason,
          },
        });
        await this.audit(
          tx,
          actorId,
          'CONTENT_HIDDEN',
          record.id,
          reason,
          { status: target.status },
          {
            status: 'HIDDEN',
            scope: context.scope,
            targetType,
            targetId,
            caseId: caseId ?? null,
          },
        );
        if (!active.length && target.status !== 'HIDDEN')
          await this.notice(tx, target.authorId, actorId, record.id);
      }
    } else {
      if (
        active.some((record) => record.scope === 'PLATFORM') &&
        context.scope !== 'PLATFORM'
      )
        throw new ForbiddenException(
          'A platform restriction must be reviewed by platform staff',
        );
      for (const record of active) {
        await tx.contentEnforcement.update({
          where: { id: record.id },
          data: { revokedAt: new Date() },
        });
        await this.audit(
          tx,
          actorId,
          'CONTENT_RESTORED',
          record.id,
          reason,
          { status: 'HIDDEN' },
          { status: 'PUBLISHED', targetType, targetId },
        );
      }
      if (active.length && target.status === 'HIDDEN')
        await this.notice(tx, target.authorId, actorId, active[0].id);
      if (!active.length && target.status === 'HIDDEN')
        throw new ConflictException(
          'This legacy restriction requires platform review',
        );
    }
    const to = hidden ? 'HIDDEN' : 'PUBLISHED';
    if (target.status !== to) {
      const changed =
        targetType === 'POST'
          ? await this.posts.transitionStatus(tx, {
              id: targetId,
              gameId,
              from: target.status,
              to,
            })
          : await this.comments.transitionStatus(tx, {
              id: targetId,
              postId: 'postId' in target ? target.postId : '',
              from: target.status as 'PUBLISHED' | 'HIDDEN',
              to,
            });
      if (!changed)
        throw new ConflictException(
          'Content changed while it was being reviewed',
        );
    }
    return { targetId, targetType, status: to };
  }
  async contentForCase(
    actorId: string,
    caseId: string,
    hidden: boolean,
    reason: string,
    gameSlug?: string,
  ) {
    reason = this.reason(reason);
    return this.db.$transaction(async (tx) => {
      const context = await this.context(tx, actorId, gameSlug);
      const { item } = await this.caseTarget(tx, caseId, context);
      return this.contentInTransaction(
        tx,
        context,
        actorId,
        item.targetType,
        item.targetId,
        hidden,
        reason,
        caseId,
      );
    });
  }
  async confirm(
    actorId: string,
    caseId: string,
    dto: ConfirmViolationDto,
    gameSlug?: string,
  ) {
    const reason = this.reason(dto.reason);
    return this.db.$transaction(async (tx) => {
      const context = await this.context(tx, actorId, gameSlug);
      const { item, target } = await this.caseTarget(tx, caseId, context);
      await this.subject(tx, context, target.authorId);
      await this.lockSubject(tx, target.authorId);
      if (!['OPEN', 'IN_REVIEW'].includes(item.status))
        throw new ConflictException(
          'Only an active case can establish a violation',
        );
      const incidentKey = createHash('sha256')
        .update(
          JSON.stringify([
            item.targetType,
            item.targetId,
            'title' in target ? target.title : null,
            target.content,
          ]),
        )
        .digest('hex');
      const existing = await tx.moderationViolation.findFirst({
        where: { reversedAt: null, OR: [{ caseId }, { incidentKey }] },
      });
      if (existing) {
        if (
          existing.caseId === caseId &&
          !existing.reversedAt &&
          existing.category === dto.category &&
          existing.severity === dto.severity &&
          existing.reason === reason
        )
          return this.publicViolation(existing);
        throw new ConflictException(
          'This incident already has a recorded finding; review its history',
        );
      }
      const record = await tx.moderationViolation.create({
        data: {
          caseId,
          incidentKey,
          subjectId: target.authorId,
          actorId,
          scope: context.scope,
          gameId: context.gameId,
          category: dto.category,
          severity: dto.severity,
          reason,
        },
      });
      await this.audit(
        tx,
        actorId,
        'VIOLATION_CONFIRMED',
        record.id,
        reason,
        {},
        {
          caseId,
          subjectId: target.authorId,
          scope: context.scope,
          gameId: context.gameId,
          category: dto.category,
          severity: dto.severity,
        },
      );
      return this.publicViolation(record);
    });
  }
  async sanction(
    actorId: string,
    caseId: string,
    dto: SanctionDto,
    gameSlug?: string,
  ) {
    const reason = this.reason(dto.reason);
    return this.db.$transaction(async (tx) => {
      const context = await this.context(tx, actorId, gameSlug);
      const { target } = await this.caseTarget(tx, caseId, context);
      await this.subject(tx, context, target.authorId);
      await this.lockSubject(tx, target.authorId);
      const communityType = dto.type.startsWith('COMMUNITY_');
      if (
        (communityType && context.scope !== 'COMMUNITY') ||
        (!communityType &&
          dto.type !== 'WARNING' &&
          context.scope !== 'PLATFORM')
      )
        throw new ForbiddenException(
          'Choose the workspace matching this sanction scope',
        );
      const startsAt = new Date();
      let expiresAt: Date | null;
      try {
        expiresAt = sanctionExpiry(
          dto.type,
          dto.durationDays,
          context.actor.role === 'ADMIN',
          startsAt,
        );
      } catch (error) {
        throw new BadRequestException((error as Error).message);
      }
      const requestHash = createHash('sha256')
        .update(
          JSON.stringify([
            actorId,
            caseId,
            context.scope,
            context.gameId,
            dto.type,
            dto.durationDays,
            reason,
            dto.violationId,
            dto.enforcementId,
          ]),
        )
        .digest('hex');
      const requestKey = `${actorId}:${dto.requestKey}`;
      const existing = await tx.moderationSanction.findUnique({
        where: { requestKey },
        select: { ...PUBLIC_SANCTION, requestHash: true },
      });
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new ConflictException(
            'This request key was already used for another action',
          );
        const { requestHash: _, ...publicRecord } = existing;
        return publicRecord;
      }
      if (
        dto.type !== 'WARNING' &&
        (await tx.moderationSanction.count({
          where: {
            subjectId: target.authorId,
            type: dto.type,
            scope: context.scope,
            gameId: context.gameId,
            status: 'ACTIVE',
            expiresAt: { gt: new Date() },
          },
        }))
      )
        throw new ConflictException(
          'An effective sanction of this type already exists. Adjust or revoke that decision first',
        );
      if (dto.violationId) {
        const violation = await tx.moderationViolation.findUnique({
          where: { id: dto.violationId },
        });
        if (
          !violation ||
          violation.caseId !== caseId ||
          violation.subjectId !== target.authorId ||
          violation.reversedAt ||
          violation.scope !== context.scope ||
          violation.gameId !== context.gameId
        )
          throw new BadRequestException(
            'Choose an effective violation from this case and scope',
          );
      }
      if (dto.enforcementId) {
        const record = await tx.contentEnforcement.findUnique({
          where: { id: dto.enforcementId },
        });
        if (
          !record ||
          record.caseId !== caseId ||
          record.subjectId !== target.authorId ||
          record.revokedAt ||
          record.scope !== context.scope
        )
          throw new BadRequestException(
            'Choose an active content restriction from this case and scope',
          );
      }
      const record = await tx.moderationSanction.create({
        data: {
          subjectId: target.authorId,
          actorId,
          type: dto.type,
          scope: context.scope,
          gameId: context.gameId,
          caseId,
          violationId: dto.violationId,
          enforcementId: dto.enforcementId,
          reason,
          startsAt,
          expiresAt,
          requestKey,
          requestHash,
        },
        select: PUBLIC_SANCTION,
      });
      if (dto.type !== 'WARNING')
        await releaseModeratorCases(
          tx,
          target.authorId,
          context.scope === 'COMMUNITY' ? { gameId: context.gameId! } : {},
        );
      await this.audit(
        tx,
        actorId,
        'SANCTION_ISSUED',
        record.id,
        reason,
        {},
        {
          type: record.type,
          scope: record.scope,
          expiresAt: expiresAt?.toISOString() ?? null,
        },
      );
      await this.notice(tx, target.authorId, actorId, record.id);
      return record;
    });
  }
  private async scopedSanction(
    tx: Tx,
    actorId: string,
    id: string,
    gameSlug?: string,
  ) {
    const context = await this.context(tx, actorId, gameSlug);
    const record = await tx.moderationSanction.findUnique({ where: { id } });
    if (
      !record ||
      (context.scope === 'COMMUNITY' &&
        (record.scope !== 'COMMUNITY' || record.gameId !== context.gameId))
    )
      throw new NotFoundException('Sanction unavailable in this workspace');
    await this.subject(tx, context, record.subjectId);
    await this.lockSubject(tx, record.subjectId);
    await tx.$queryRaw`SELECT id FROM moderation_sanctions WHERE id=${id} FOR UPDATE`;
    return {
      context,
      record: await tx.moderationSanction.findUniqueOrThrow({ where: { id } }),
    };
  }
  async revoke(actorId: string, id: string, reason: string, gameSlug?: string) {
    reason = this.reason(reason);
    return this.db.$transaction(async (tx) => {
      const { record } = await this.scopedSanction(tx, actorId, id, gameSlug);
      if (record.status === 'REVOKED') return { id, status: record.status };
      if (
        record.status === 'EXPIRED' ||
        (record.expiresAt && record.expiresAt <= new Date())
      )
        throw new ConflictException(
          'Expired restrictions remain in history and may be appealed',
        );
      await this.revokeTx(tx, actorId, record, reason);
      return { id, status: 'REVOKED' };
    });
  }
  private async revokeTx(
    tx: Tx,
    actorId: string,
    record: {
      id: string;
      subjectId: string;
      status: string;
      expiresAt?: Date | null;
    },
    reason: string,
  ) {
    if (record.status === 'REVOKED' || record.status === 'EXPIRED') return;
    if (record.expiresAt && record.expiresAt <= new Date()) {
      await tx.moderationSanction.update({
        where: { id: record.id },
        data: { status: 'EXPIRED' },
      });
      await this.audit(
        tx,
        actorId,
        'SANCTION_EXPIRED',
        record.id,
        'The scheduled restriction ended',
        { status: record.status },
        { status: 'EXPIRED' },
      );
      await this.notice(tx, record.subjectId, actorId, record.id);
      return;
    }
    await tx.moderationSanction.update({
      where: { id: record.id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    await this.audit(
      tx,
      actorId,
      'SANCTION_REVOKED',
      record.id,
      reason,
      { status: record.status },
      { status: 'REVOKED' },
    );
    await this.notice(tx, record.subjectId, actorId, record.id);
  }
  async adjust(
    actorId: string,
    id: string,
    dto: AdjustSanctionDto,
    gameSlug?: string,
  ) {
    const reason = this.reason(dto.reason);
    return this.db.$transaction(async (tx) => {
      const { context, record } = await this.scopedSanction(
        tx,
        actorId,
        id,
        gameSlug,
      );
      if (
        record.status !== 'ACTIVE' ||
        !record.expiresAt ||
        record.expiresAt <= new Date()
      )
        throw new ConflictException(
          'Only an effective temporary sanction can be adjusted',
        );
      let expiresAt: Date | null;
      try {
        expiresAt = sanctionExpiry(
          record.type,
          dto.durationDays,
          context.actor.role === 'ADMIN',
          record.startsAt,
        );
      } catch (error) {
        throw new BadRequestException((error as Error).message);
      }
      if (!expiresAt || expiresAt <= new Date())
        throw new BadRequestException(
          'The adjusted end must be in the future; expired sanctions require a new explicit decision',
        );
      await tx.moderationSanction.update({
        where: { id },
        data: { expiresAt },
      });
      await this.audit(
        tx,
        actorId,
        'SANCTION_ADJUSTED',
        id,
        reason,
        { expiresAt: record.expiresAt.toISOString() },
        { expiresAt: expiresAt?.toISOString() ?? null },
      );
      await this.notice(tx, record.subjectId, actorId, id);
      return { id, expiresAt };
    });
  }
  async reverseViolation(
    actorId: string,
    id: string,
    reason: string,
    gameSlug?: string,
  ) {
    reason = this.reason(reason);
    return this.db.$transaction(async (tx) => {
      const context = await this.context(tx, actorId, gameSlug);
      const record = await tx.moderationViolation.findUnique({ where: { id } });
      if (
        !record ||
        (context.scope === 'COMMUNITY' &&
          (record.scope !== context.scope || record.gameId !== context.gameId))
      )
        throw new NotFoundException('Finding unavailable in this workspace');
      await this.subject(tx, context, record.subjectId);
      await this.lockSubject(tx, record.subjectId);
      await this.reverseTx(tx, actorId, record.id, reason);
      return { id, reversed: true };
    });
  }
  private async reverseTx(tx: Tx, actorId: string, id: string, reason: string) {
    const changed = await tx.moderationViolation.updateMany({
      where: { id, reversedAt: null },
      data: { reversedAt: new Date() },
    });
    if (changed.count)
      await this.audit(
        tx,
        actorId,
        'VIOLATION_REVERSED',
        id,
        reason,
        { confirmed: true },
        { confirmed: false },
      );
    // Consequences attached to this finding must not survive its reversal.
    const sanctions = await tx.moderationSanction.findMany({
      where: { violationId: id, status: { not: 'REVOKED' } },
    });
    for (const sanction of sanctions)
      await this.revokeTx(tx, actorId, sanction, reason);
  }
  async own(subjectId: string, cursor?: string, contentCursor?: string) {
    const rows = await this.db.moderationSanction.findMany({
      where: { subjectId },
      select: PUBLIC_SANCTION,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const content = await this.db.contentEnforcement.findMany({
      where: { subjectId },
      select: {
        id: true,
        targetType: true,
        reason: true,
        scope: true,
        createdAt: true,
        revokedAt: true,
        game: { select: { name: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
      ...(contentCursor ? { cursor: { id: contentCursor }, skip: 1 } : {}),
    });
    return {
      contentNotices: content.slice(0, 50),
      contentNextCursor: content.length > 50 ? content[49].id : null,
      items: rows.slice(0, 50).map((row) => ({
        ...row,
        effectiveStatus:
          row.status === 'ACTIVE' &&
          row.expiresAt &&
          row.expiresAt <= new Date()
            ? 'EXPIRED'
            : row.status,
      })),
      nextCursor: rows.length > 50 ? rows[49].id : null,
    };
  }
  async appeal(subjectId: string, sanctionId: string, statement: string) {
    statement = statement.trim();
    if (statement.length < 10 || statement.length > 2000)
      throw new BadRequestException(
        'Explain your appeal in 10 to 2000 characters',
      );
    return this.db.$transaction(async (tx) => {
      await this.lockSubject(tx, subjectId);
      const record = await tx.moderationSanction.findUnique({
        where: { id: sanctionId },
      });
      if (!record || record.subjectId !== subjectId)
        throw new NotFoundException('Sanction not found');
      if (record.status === 'REVOKED')
        throw new ConflictException('This sanction has already been revoked');
      const existing = await tx.moderationAppeal.findUnique({
        where: { sanctionId },
      });
      if (existing)
        throw new ConflictException(
          'An appeal already exists for this decision',
        );
      const created = await tx.moderationAppeal.create({
        data: { sanctionId, statement },
      });
      await this.audit(
        tx,
        subjectId,
        'APPEAL_SUBMITTED',
        created.id,
        'Account holder requested a review',
        {},
        { status: 'PENDING', sanctionId },
      );
      return { id: created.id, status: created.status };
    });
  }
  async appeals(actorId: string, gameSlug?: string, cursor?: string) {
    return this.db.$transaction(async (tx) => {
      const context = await this.context(tx, actorId, gameSlug);
      const rows = await tx.moderationAppeal.findMany({
        where: {
          ...(context.scope === 'COMMUNITY'
            ? { sanction: { scope: 'COMMUNITY', gameId: context.gameId } }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 51,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          sanction: { select: { ...PUBLIC_SANCTION, actorId: true } },
        },
      });
      const adjustments = await tx.moderationDecisionAudit.findMany({
        where: {
          actorId,
          action: 'SANCTION_ADJUSTED',
          entityId: { in: rows.map((row) => row.sanctionId) },
        },
        select: { entityId: true },
      });
      const adjusted = new Set(adjustments.map((row) => row.entityId));
      return {
        items: rows.slice(0, 50).map((row) => ({
          ...row,
          canReview:
            row.status === 'PENDING' &&
            row.sanction.actorId !== actorId &&
            !adjusted.has(row.sanctionId),
        })),
        nextCursor: rows.length > 50 ? rows[49].id : null,
      };
    });
  }
  async reviewAppeal(
    actorId: string,
    id: string,
    dto: ReviewAppealDto,
    gameSlug?: string,
  ) {
    const reason = this.reason(dto.reason);
    return this.db.$transaction(async (tx) => {
      const appeal = await tx.moderationAppeal.findUnique({ where: { id } });
      if (!appeal) throw new NotFoundException('Appeal not found');
      const { context, record } = await this.scopedSanction(
        tx,
        actorId,
        appeal.sanctionId,
        gameSlug,
      );
      if (
        record.actorId === actorId ||
        (await tx.moderationDecisionAudit.count({
          where: { actorId, entityId: record.id, action: 'SANCTION_ADJUSTED' },
        }))
      )
        throw new ForbiddenException(
          'Another moderator must independently review this appeal',
        );
      const fresh = await tx.moderationAppeal.findUniqueOrThrow({
        where: { id },
      });
      if (fresh.status !== 'PENDING')
        throw new ConflictException('This appeal already has a decision');
      if (dto.decision === 'ACCEPTED') {
        await this.revokeTx(tx, actorId, record, reason);
        if (dto.reverseViolation && record.violationId) {
          const violation = await tx.moderationViolation.findUniqueOrThrow({
            where: { id: record.violationId },
          });
          if (
            context.scope === 'COMMUNITY' &&
            (violation.scope !== 'COMMUNITY' ||
              violation.gameId !== context.gameId)
          )
            throw new ForbiddenException(
              'A platform finding requires platform review',
            );
          await this.reverseTx(tx, actorId, record.violationId, reason);
        }
        if (dto.restoreContent && record.enforcementId) {
          const enforcement = await tx.contentEnforcement.findUniqueOrThrow({
            where: { id: record.enforcementId },
          });
          if (
            context.scope === 'COMMUNITY' &&
            enforcement.scope !== 'COMMUNITY'
          )
            throw new ForbiddenException(
              'A platform restriction requires platform review',
            );
          await this.restoreAppealedContent(tx, actorId, enforcement, reason);
        }
      } else if (dto.reverseViolation || dto.restoreContent)
        throw new BadRequestException('Reversals require an accepted appeal');
      await tx.moderationAppeal.update({
        where: { id },
        data: {
          status: dto.decision,
          reviewerId: actorId,
          decisionReason: reason,
          reviewedAt: new Date(),
        },
      });
      await this.audit(
        tx,
        actorId,
        `APPEAL_${dto.decision}`,
        id,
        reason,
        { status: 'PENDING' },
        { status: dto.decision, sanctionId: record.id },
      );
      await this.notice(tx, record.subjectId, actorId, id);
      return { id, status: dto.decision };
    });
  }
  private async restoreAppealedContent(
    tx: Tx,
    actorId: string,
    record: {
      id: string;
      targetType: 'POST' | 'COMMENT';
      targetId: string;
      gameId: string | null;
      subjectId: string;
    },
    reason: string,
  ) {
    if (record.targetType === 'POST')
      await tx.$queryRaw`SELECT id FROM posts WHERE id=${record.targetId} FOR UPDATE`;
    else
      await tx.$queryRaw`SELECT id FROM comments WHERE id=${record.targetId} FOR UPDATE`;
    await tx.contentEnforcement.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });
    const remaining = await tx.contentEnforcement.count({
      where: {
        targetType: record.targetType,
        targetId: record.targetId,
        revokedAt: null,
      },
    });
    let restored = false;
    if (!remaining && record.targetType === 'POST') {
      const post = await tx.post.findUnique({ where: { id: record.targetId } });
      if (post && !post.deletedAt && post.status === 'HIDDEN') {
        await this.posts.transitionStatus(tx, {
          id: post.id,
          gameId: post.gameId,
          from: 'HIDDEN',
          to: 'PUBLISHED',
        });
        restored = true;
      }
    } else if (!remaining) {
      const comment = await tx.comment.findUnique({
        where: { id: record.targetId },
      });
      if (comment && !comment.deletedAt && comment.status === 'HIDDEN') {
        await this.comments.transitionStatus(tx, {
          id: comment.id,
          postId: comment.postId,
          from: 'HIDDEN',
          to: 'PUBLISHED',
        });
        restored = true;
      }
    }
    await this.audit(
      tx,
      actorId,
      'CONTENT_APPEAL_REVERSED',
      record.id,
      reason,
      { restricted: true },
      { restricted: false, publiclyRestored: restored },
    );
    await this.notice(tx, record.subjectId, actorId, record.id);
  }
  async operations(actorId: string) {
    return this.db.$transaction(async (tx) => {
      await this.context(tx, actorId);
      const [
        analysisPending,
        analysisFailed,
        policyPending,
        policyFailed,
        outboxPending,
        outboxFailed,
        overdueSanctions,
        pendingAppeals,
        oldestAnalysis,
        oldestAppeal,
      ] = await Promise.all([
        tx.moderationAnalysis.count({ where: { status: 'PENDING' } }),
        tx.moderationAnalysis.count({ where: { status: 'FAILED' } }),
        tx.moderationPolicyEvaluation.count({ where: { status: 'PENDING' } }),
        tx.moderationPolicyEvaluation.count({ where: { status: 'FAILED' } }),
        tx.outboxEvent.count({
          where: { status: { in: ['PENDING', 'PROCESSING'] } },
        }),
        tx.outboxEvent.count({ where: { status: 'FAILED' } }),
        tx.moderationSanction.count({
          where: { status: 'ACTIVE', expiresAt: { lte: new Date() } },
        }),
        tx.moderationAppeal.count({ where: { status: 'PENDING' } }),
        tx.moderationAnalysis.findFirst({
          where: { status: 'PENDING' },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
        tx.moderationAppeal.findFirst({
          where: { status: 'PENDING' },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
      ]);
      return {
        analysisPending,
        analysisFailed,
        policyPending,
        policyFailed,
        outboxPending,
        outboxFailed,
        overdueSanctions,
        pendingAppeals,
        oldestPendingAnalysisSeconds: oldestAnalysis
          ? Math.max(
              0,
              Math.floor(
                (Date.now() - oldestAnalysis.createdAt.getTime()) / 1000,
              ),
            )
          : 0,
        oldestPendingAppealSeconds: oldestAppeal
          ? Math.max(
              0,
              Math.floor(
                (Date.now() - oldestAppeal.createdAt.getTime()) / 1000,
              ),
            )
          : 0,
      };
    });
  }
  async overview(actorId: string, caseId: string, gameSlug?: string) {
    return this.db.$transaction(
      async (tx) => {
        const context = await this.context(tx, actorId, gameSlug);
        const { item, target } = await this.caseTarget(tx, caseId, context);
        const scope =
          context.scope === 'COMMUNITY'
            ? { scope: 'COMMUNITY' as const, gameId: context.gameId }
            : {};
        const subject = await tx.user.findUniqueOrThrow({
          where: { id: target.authorId },
          select: {
            id: true,
            name: true,
            role: true,
            moderatedGames: { take: 1, select: { id: true } },
          },
        });
        const [violations, sanctions, contentHistory] = await Promise.all([
          tx.moderationViolation.findMany({
            where: { subjectId: subject.id, ...scope },
            orderBy: { createdAt: 'desc' },
          }),
          tx.moderationSanction.findMany({
            where: { subjectId: subject.id, ...scope },
            select: PUBLIC_SANCTION,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 50,
          }),
          tx.contentEnforcement.findMany({
            where: {
              targetType: item.targetType,
              targetId: item.targetId,
              ...scope,
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
          }),
        ]);
        const counts = await tx.$queryRaw<
          Array<{
            reports: bigint;
            cases: bigint;
            pending: bigint;
            dismissedReports: bigint;
          }>
        >`
        SELECT coalesce(sum(c."reportCount"),0)::bigint AS reports, count(*)::bigint AS cases,
          count(*) FILTER (WHERE c.status IN ('OPEN','IN_REVIEW'))::bigint AS pending,
          coalesce(sum(c."reportCount") FILTER (WHERE c.status='DISMISSED'),0)::bigint AS "dismissedReports"
        FROM moderation_cases c JOIN (
          SELECT id, 'POST' AS kind FROM posts WHERE "authorId"=${subject.id}
          UNION ALL SELECT id, 'COMMENT' AS kind FROM comments WHERE "authorId"=${subject.id}
        ) target ON target.id=c."targetId" AND target.kind=c."targetType"::text
        WHERE ${context.scope === 'COMMUNITY' ? Prisma.sql`c."gameId"=${context.gameId}` : Prisma.sql`TRUE`}`;
        const totals = await tx.$queryRaw<
          Array<{
            warnings: bigint;
            previousSuspensions: bigint;
            activeSanctions: bigint;
            expiredSanctions: bigint;
            revokedSanctions: bigint;
            successfulAppeals: bigint;
          }>
        >`
          SELECT count(*) FILTER (WHERE s.type='WARNING')::bigint AS warnings,
          count(*) FILTER (WHERE s.type='PLATFORM_SUSPENSION')::bigint AS "previousSuspensions",
          count(*) FILTER (WHERE s.status='ACTIVE' AND s.type <> 'WARNING' AND s."expiresAt">now())::bigint AS "activeSanctions",
          count(*) FILTER (WHERE s.status='EXPIRED' OR (s.status='ACTIVE' AND s."expiresAt"<=now()))::bigint AS "expiredSanctions",
          count(*) FILTER (WHERE s.status='REVOKED')::bigint AS "revokedSanctions",
          count(*) FILTER (WHERE a.status='ACCEPTED')::bigint AS "successfulAppeals"
          FROM moderation_sanctions s LEFT JOIN moderation_appeals a ON a."sanctionId"=s.id
          WHERE s."subjectId"=${subject.id} AND ${context.scope === 'COMMUNITY' ? Prisma.sql`s.scope='COMMUNITY' AND s."gameId"=${context.gameId}` : Prisma.sql`TRUE`}`;
        const now = new Date();
        const risk = computeUserRisk(violations, now);
        const effectiveStatus = (s: (typeof sanctions)[number]) =>
          s.status === 'ACTIVE' && s.expiresAt && s.expiresAt <= now
            ? 'EXPIRED'
            : s.status;
        const entityIds = [
          ...violations.slice(0, 50).map((r) => r.id),
          ...sanctions.map((r) => r.id),
          ...sanctions.flatMap((r) => (r.appeal ? [r.appeal.id] : [])),
          ...contentHistory.map((r) => r.id),
        ];
        const history = await tx.moderationDecisionAudit.findMany({
          where: { entityId: { in: entityIds } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 100,
          include: { actor: { select: { name: true } } },
        });
        return {
          subject: { id: subject.id, name: subject.name },
          scope: context.scope,
          counts: {
            ...Object.fromEntries(
              Object.entries(totals[0] || {}).map(([key, value]) => [
                key,
                Number(value),
              ]),
            ),
            reports: Number(counts[0]?.reports ?? 0),
            cases: Number(counts[0]?.cases ?? 0),
            pending: Number(counts[0]?.pending ?? 0),
            dismissedReports: Number(counts[0]?.dismissedReports ?? 0),
            confirmedViolations: violations.filter((v) => !v.reversedAt).length,
            reversedFindings: violations.filter((v) => v.reversedAt).length,
          },
          risk: { ...risk, factors: risk.factors.slice(-50) },
          violations: violations
            .slice(0, 50)
            .map((row) => this.publicViolation(row)),
          sanctions: sanctions.map((s) => ({
            ...s,
            effectiveStatus: effectiveStatus(s),
          })),
          contentHistory,
          history,
          permissions: {
            durationDays: durationPolicy(),
            canSanction:
              subject.id !== actorId &&
              subject.role !== 'ADMIN' &&
              (context.actor.role === 'ADMIN' ||
                (subject.role === 'USER' && !subject.moderatedGames.length)),
            canConfirm: ['OPEN', 'IN_REVIEW'].includes(item.status),
            customDuration: context.actor.role === 'ADMIN',
            scope: context.scope,
            sanctionTypes:
              context.scope === 'COMMUNITY'
                ? ['WARNING', 'COMMUNITY_RESTRICTION', 'COMMUNITY_BAN']
                : ['WARNING', 'PLATFORM_SUSPENSION'],
          },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
