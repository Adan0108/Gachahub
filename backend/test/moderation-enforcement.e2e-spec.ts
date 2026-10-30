import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EnforcementService } from '../src/moderation-enforcement/enforcement.service';
import { SanctionAccessService } from '../src/moderation-enforcement/sanction-access.service';
import { SanctionExpirationService } from '../src/moderation-enforcement/expiration.service';
import { PostsRepository } from '../src/posts/posts.repository';
import { CommentsRepository } from '../src/comments/comments.repository';
import { OutboxRepository } from '../src/outbox/outbox.repository';
import { OutboxEventPublisher } from '../src/outbox/outbox-event.publisher';
import { isolatedCaseDatabase } from './support/isolated-case-database';
import type { PrismaService } from '../src/prisma/prisma.service';
import { communityAccessWhere } from '../src/post-visibility/visibility-where';

const enabled = process.env.RUN_MODERATION_ENFORCEMENT_DB === '1';
(enabled ? describe : describe.skip)(
  'Stage 2E isolated PostgreSQL enforcement',
  () => {
    jest.setTimeout(120000);
    let isolated: Awaited<ReturnType<typeof isolatedCaseDatabase>>;
    let db: PrismaService;
    let service: EnforcementService;
    let access: SanctionAccessService;
    let actors: {
      admin: string;
      platform: string;
      reviewer: string;
      community: string;
      author: string;
      outsider: string;
    };
    let gameId: string;
    let slug: string;
    let caseId: string;
    let postId: string;
    const reason = 'Confirmed after reviewing the surrounding context';
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL || '');
      if (
        !['localhost', '127.0.0.1'].includes(url.hostname) ||
        url.port !== '55432' ||
        url.pathname !== '/stage2e_test'
      )
        throw new Error(
          'Use only the dedicated Stage 2E test PostgreSQL instance',
        );
      isolated = await isolatedCaseDatabase();
      db = isolated.prisma as unknown as PrismaService;
      await db.$executeRawUnsafe(
        readFileSync(
          resolve(
            __dirname,
            '../prisma/migrations/20261030120100_moderation_enforcement_constraints/migration.sql',
          ),
          'utf8',
        ),
      );
      service = new EnforcementService(
        db,
        new OutboxEventPublisher(new OutboxRepository(db)),
        new PostsRepository(db),
        new CommentsRepository(db),
      );
      for (const name of [
        '20261030120200_enforcement_visibility_guards',
        '20261030120300_require_temporary_sanction_expiration',
      ]) {
        await db.$executeRawUnsafe(
          readFileSync(
            resolve(__dirname, `../prisma/migrations/${name}/migration.sql`),
            'utf8',
          ),
        );
      }
      access = new SanctionAccessService(db);
      actors = Object.fromEntries(
        await Promise.all(
          [
            'admin',
            'platform',
            'reviewer',
            'community',
            'author',
            'outsider',
          ].map(async (key) => {
            const user = await db.user.create({
              data: {
                id: randomUUID(),
                name: key,
                email: `${randomUUID()}@example.invalid`,
                role:
                  key === 'admin'
                    ? 'ADMIN'
                    : ['platform', 'reviewer'].includes(key)
                      ? 'PLATFORM_MODERATOR'
                      : 'USER',
              },
            });
            return [key, user.id];
          }),
        ),
      ) as typeof actors;
      slug = 'stage2e-' + randomUUID();
      const game = await db.game.create({
        data: { name: 'Isolated moderation community', slug },
      });
      gameId = game.id;
      await db.gameModerator.create({
        data: { gameId, userId: actors.community, assignedBy: actors.admin },
      });
    });
    beforeEach(async () => {
      // New incidents per test; never reset, truncate or delete shared data.
      const post = await db.post.create({
        data: {
          authorId: actors.author,
          gameId,
          type: 'GENERAL',
          title: randomUUID(),
          content: 'A reported fictional dialogue',
        },
      });
      postId = post.id;
      const item = await db.moderationCase.create({
        data: { targetId: postId, targetType: 'POST', gameId },
      });
      caseId = item.id;
      const active = await db.moderationSanction.findMany({
        where: { subjectId: actors.author, status: 'ACTIVE' },
      });
      for (const row of active)
        await service.revoke(
          actors.admin,
          row.id,
          'End previous isolated test restriction',
        );
    });
    afterAll(async () => {
      await isolated?.cleanup();
    });
    it('separates ten allegations from one human finding and deduplicates confirmations', async () => {
      await db.moderationCase.update({
        where: { id: caseId },
        data: { reportCount: 10, uniqueReporterCount: 10 },
      });
      expect((await service.overview(actors.platform, caseId)).risk.score).toBe(
        0,
      );
      const dto = {
        category: 'HARASSMENT' as const,
        severity: 'MINOR' as const,
        reason,
      };
      const results = await Promise.all([
        service.confirm(actors.platform, caseId, dto),
        service.confirm(actors.platform, caseId, dto),
      ]);
      expect(results[0].id).toBe(results[1].id);
      expect(await db.moderationViolation.count({ where: { caseId } })).toBe(1);
    });
    it('prevents community restoration over a platform hide and keeps both histories', async () => {
      await service.contentForCase(
        actors.community,
        caseId,
        true,
        reason,
        slug,
      );
      await service.contentForCase(actors.platform, caseId, true, reason);
      await expect(
        service.contentForCase(actors.community, caseId, false, reason, slug),
      ).rejects.toThrow('platform restriction');
      expect(
        (await db.post.findUniqueOrThrow({ where: { id: postId } })).status,
      ).toBe('HIDDEN');
      await service.contentForCase(actors.platform, caseId, false, reason);
      expect(
        (await db.post.findUniqueOrThrow({ where: { id: postId } })).status,
      ).toBe('PUBLISHED');
      expect(
        await db.contentEnforcement.count({ where: { targetId: postId } }),
      ).toBe(2);
    });
    it('protects deleted content and unrelated community scope', async () => {
      await expect(
        service.contentForCase(actors.outsider, caseId, true, reason, slug),
      ).rejects.toThrow();
      await db.post.update({
        where: { id: postId },
        data: { status: 'DELETED', deletedAt: new Date() },
      });
      await expect(
        service.contentForCase(actors.platform, caseId, false, reason),
      ).rejects.toThrow('Deleted content');
    });
    it('replays the same sanction request once and rejects key reuse with another payload', async () => {
      const dto = {
        type: 'PLATFORM_SUSPENSION' as const,
        reason,
        durationDays: 1,
        requestKey: randomUUID(),
      };
      const results = await Promise.all([
        service.sanction(actors.platform, caseId, dto),
        service.sanction(actors.platform, caseId, dto),
      ]);
      expect(results[0].id).toBe(results[1].id);
      await expect(
        service.sanction(actors.platform, caseId, { ...dto, durationDays: 7 }),
      ).rejects.toThrow('request key');
      await expect(access.assertAllowed(actors.author, true)).rejects.toThrow();
      await expect(
        access.assertAllowed(actors.author, false),
      ).rejects.toThrow();
    });
    it.each([1, 3, 7, 30])(
      'enforces %s-day platform suspensions against reads and writes',
      async (durationDays) => {
        await service.sanction(actors.platform, caseId, {
          type: 'PLATFORM_SUSPENSION',
          reason,
          durationDays,
          requestKey: randomUUID(),
        });
        await expect(
          access.assertAllowed(actors.author, false),
        ).rejects.toThrow();
        await expect(
          access.assertAllowed(actors.author, true),
        ).rejects.toThrow();
      },
    );
    it('community restrictions and bans do not affect another community or private messages', async () => {
      await service.sanction(
        actors.community,
        caseId,
        {
          type: 'COMMUNITY_RESTRICTION',
          reason,
          durationDays: 3,
          requestKey: randomUUID(),
        },
        slug,
      );
      await expect(
        access.assertAllowed(actors.author, true, gameId),
      ).rejects.toThrow();
      await expect(
        access.assertAllowed(actors.author, false, gameId),
      ).resolves.toBeUndefined();
      await expect(
        access.assertAllowed(actors.author, true, 'another-game'),
      ).resolves.toBeUndefined();
      await service.sanction(
        actors.community,
        caseId,
        {
          type: 'COMMUNITY_BAN',
          reason,
          durationDays: 7,
          requestKey: randomUUID(),
        },
        slug,
      );
      await expect(
        access.assertAllowed(actors.author, false, gameId),
      ).rejects.toThrow();
      expect(
        await db.post.count({
          where: { id: postId, ...communityAccessWhere(actors.author) },
        }),
      ).toBe(0);
      expect(
        await db.post.count({
          where: { id: postId, ...communityAccessWhere(actors.outsider) },
        }),
      ).toBe(1);
      expect(
        await access.routeGame('/posts', {}, undefined, { gameSlug: slug }),
      ).toBe(gameId);
      // Unrelated query scopes cannot override an existing post's community.
      expect(
        await access.routeGame('/posts/:id', { id: postId }, undefined, {
          gameSlug: 'other',
        }),
      ).toBe(gameId);
    });
    it('filters full platform restrictions from realtime recipients using live expiry', async () => {
      const record = await service.sanction(actors.platform, caseId, {
        type: 'PLATFORM_SUSPENSION',
        reason,
        durationDays: 1,
        requestKey: randomUUID(),
      });
      expect(
        await access.blockedReaders([actors.author, actors.outsider]),
      ).toEqual(new Set([actors.author]));
      await service.revoke(actors.platform, record.id, reason);
      await service.sanction(
        actors.community,
        caseId,
        {
          type: 'COMMUNITY_RESTRICTION',
          reason,
          durationDays: 1,
          requestKey: randomUUID(),
        },
        slug,
      );
      expect(await access.blockedReaders([actors.author])).toEqual(new Set());
    });
    it('expired sanctions restore access without restoring hidden content and notify once', async () => {
      await service.contentForCase(actors.platform, caseId, true, reason);
      const record = await service.sanction(actors.platform, caseId, {
        type: 'PLATFORM_SUSPENSION',
        reason,
        durationDays: 1,
        requestKey: randomUUID(),
      });
      await db.moderationSanction.update({
        where: { id: record.id },
        data: {
          startsAt: new Date(Date.now() - 3 * 86400000),
          expiresAt: new Date(Date.now() - 86400000),
        },
      });
      await expect(
        access.assertAllowed(actors.author, true),
      ).resolves.toBeUndefined();
      const runner = new SanctionExpirationService(db, service);
      await runner.reconcile();
      await runner.reconcile();
      expect(
        await db.moderationDecisionAudit.count({
          where: { entityId: record.id, action: 'SANCTION_EXPIRED' },
        }),
      ).toBe(1);
      expect(
        (await db.post.findUniqueOrThrow({ where: { id: postId } })).status,
      ).toBe('HIDDEN');
      await service.contentForCase(actors.platform, caseId, false, reason);
      expect(
        (await db.post.findUniqueOrThrow({ where: { id: postId } })).status,
      ).toBe('PUBLISHED');
    });
    it('keeps warnings informational and allows only bounded Admin custom durations', async () => {
      await service.sanction(
        actors.community,
        caseId,
        { type: 'WARNING', reason, requestKey: randomUUID() },
        slug,
      );
      await expect(
        access.assertAllowed(actors.author, true, gameId),
      ).resolves.toBeUndefined();
      await expect(
        service.sanction(
          actors.community,
          caseId,
          {
            type: 'PLATFORM_SUSPENSION',
            reason,
            durationDays: 1,
            requestKey: randomUUID(),
          },
          slug,
        ),
      ).rejects.toThrow();
      await expect(
        service.sanction(actors.platform, caseId, {
          type: 'PERMANENT_BAN' as never,
          reason,
          requestKey: randomUUID(),
        }),
      ).rejects.toThrow();
      await expect(
        service.sanction(actors.platform, caseId, {
          type: 'PLATFORM_SUSPENSION',
          reason,
          durationDays: 11,
          requestKey: randomUUID(),
        }),
      ).rejects.toThrow();
      await service.sanction(actors.admin, caseId, {
        type: 'PLATFORM_SUSPENSION',
        reason,
        durationDays: 11,
        requestKey: randomUUID(),
      });
      await expect(
        access.assertAllowed(actors.author, false),
      ).rejects.toThrow();
    });
    it('accepts appeals transactionally, reverses risk and restores eligible content without deleting history', async () => {
      const violation = await service.confirm(actors.platform, caseId, {
        category: 'VIOLENCE',
        severity: 'SEVERE',
        reason,
      });
      await service.contentForCase(actors.platform, caseId, true, reason);
      const enforcement = await db.contentEnforcement.findFirstOrThrow({
        where: { targetId: postId, revokedAt: null },
      });
      const sanction = await service.sanction(actors.platform, caseId, {
        type: 'PLATFORM_SUSPENSION',
        reason,
        durationDays: 7,
        requestKey: randomUUID(),
        violationId: violation.id,
        enforcementId: enforcement.id,
      });
      const appeal = await service.appeal(
        actors.author,
        sanction.id,
        'This dialogue was quoted from a game. Please reconsider.',
      );
      await expect(
        service.appeal(
          actors.author,
          sanction.id,
          'Duplicate appeal with sufficient explanation',
        ),
      ).rejects.toThrow('already exists');
      await expect(
        service.reviewAppeal(actors.platform, appeal.id, {
          decision: 'ACCEPTED',
          reason,
        }),
      ).rejects.toThrow('Another moderator');
      await service.reviewAppeal(actors.reviewer, appeal.id, {
        decision: 'ACCEPTED',
        reason,
        reverseViolation: true,
        restoreContent: true,
      });
      expect(
        (
          await db.moderationViolation.findUniqueOrThrow({
            where: { id: violation.id },
          })
        ).reversedAt,
      ).not.toBeNull();
      expect(
        (
          await db.moderationSanction.findUniqueOrThrow({
            where: { id: sanction.id },
          })
        ).status,
      ).toBe('REVOKED');
      expect(
        (await db.post.findUniqueOrThrow({ where: { id: postId } })).status,
      ).toBe('PUBLISHED');
      expect(
        await db.moderationDecisionAudit.count({
          where: { entityId: appeal.id },
        }),
      ).toBe(2);
    });
    it('rejects permanent and over-30-day decisions for Admin without persisting anything', async () => {
      for (const type of ['PERMANENT_BAN', 'INDEFINITE', 'PLATFORM_READ_ONLY'])
        await expect(
          service.sanction(actors.admin, caseId, {
            type: type as never,
            reason,
            durationDays: 30,
            requestKey: randomUUID(),
          }),
        ).rejects.toThrow();
      for (const durationDays of [undefined, null, 0, 31, 365])
        await expect(
          service.sanction(actors.admin, caseId, {
            type: 'PLATFORM_SUSPENSION',
            reason,
            durationDays: durationDays as number,
            requestKey: randomUUID(),
          }),
        ).rejects.toThrow();
      expect(await db.moderationSanction.count({ where: { caseId } })).toBe(0);
    });
    it('caps adjustments at 30 days from the original start and never revives expired decisions', async () => {
      const record = await service.sanction(actors.admin, caseId, {
        type: 'PLATFORM_SUSPENSION',
        reason,
        durationDays: 30,
        requestKey: randomUUID(),
      });
      const start = new Date(Date.now() - 20 * 86400000);
      await db.moderationSanction.update({
        where: { id: record.id },
        data: {
          startsAt: start,
          expiresAt: new Date(start.getTime() + 30 * 86400000),
        },
      });
      const result = await service.adjust(actors.admin, record.id, {
        reason,
        durationDays: 30,
      });
      expect(result.expiresAt?.getTime()).toBe(start.getTime() + 30 * 86400000);
      await expect(
        service.adjust(actors.admin, record.id, { reason, durationDays: 31 }),
      ).rejects.toThrow();
      await expect(
        service.adjust(actors.admin, record.id, { reason, durationDays: 1 }),
      ).rejects.toThrow('future');
      await db.moderationSanction.update({
        where: { id: record.id },
        data: { expiresAt: new Date(start.getTime() + 3 * 86400000) },
      });
      await expect(
        service.adjust(actors.admin, record.id, { reason, durationDays: 30 }),
      ).rejects.toThrow('effective');
    });
    it('guards concurrent author publication at the database boundary', async () => {
      await service.contentForCase(actors.platform, caseId, true, reason);
      await expect(
        db.post.update({
          where: { id: postId },
          data: { status: 'PUBLISHED' },
        }),
      ).rejects.toThrow();
      expect(
        (await db.post.findUniqueOrThrow({ where: { id: postId } })).status,
      ).toBe('HIDDEN');
    });
    it('does not return internal hashes or reporter information in decision support or own notices', async () => {
      await service.confirm(actors.platform, caseId, {
        category: 'HARASSMENT',
        severity: 'MINOR',
        reason,
      });
      await service.contentForCase(actors.platform, caseId, true, reason);
      const overview = await service.overview(actors.platform, caseId);
      const own = await service.own(actors.author);
      expect(own.contentNotices.some((row) => row.reason === reason)).toBe(
        true,
      );
      expect(JSON.stringify([overview, own])).not.toMatch(
        /incidentKey|requestKey|requestHash|reporterId|inputSnapshot/,
      );
    });
    it('hides and restores comments without changing the parent post visibility', async () => {
      const comment = await db.comment.create({
        data: { postId, authorId: actors.author, content: 'Reported comment' },
      });
      await db.post.update({
        where: { id: postId },
        data: { commentCount: 1 },
      });
      const item = await db.moderationCase.create({
        data: { targetId: comment.id, targetType: 'COMMENT', gameId },
      });
      await service.contentForCase(
        actors.community,
        item.id,
        true,
        reason,
        slug,
      );
      expect(
        (await db.comment.findUniqueOrThrow({ where: { id: comment.id } }))
          .status,
      ).toBe('HIDDEN');
      expect(
        (await db.post.findUniqueOrThrow({ where: { id: postId } }))
          .commentCount,
      ).toBe(0);
      await service.contentForCase(
        actors.community,
        item.id,
        false,
        reason,
        slug,
      );
      expect(
        (await db.post.findUniqueOrThrow({ where: { id: postId } }))
          .commentCount,
      ).toBe(1);
      expect(
        (await db.post.findUniqueOrThrow({ where: { id: postId } })).status,
      ).toBe('PUBLISHED');
    });
    it('rolls back sanction, audit and notification together when the outbox insert fails', async () => {
      const broken = new EnforcementService(
        db,
        {
          publish: () =>
            Promise.reject(new Error('Injected persistence failure')),
        } as unknown as OutboxEventPublisher,
        new PostsRepository(db),
        new CommentsRepository(db),
      );
      await expect(
        broken.sanction(actors.platform, caseId, {
          type: 'WARNING',
          reason,
          requestKey: randomUUID(),
        }),
      ).rejects.toThrow('Injected');
      expect(await db.moderationSanction.count({ where: { caseId } })).toBe(0);
    });
  },
);
