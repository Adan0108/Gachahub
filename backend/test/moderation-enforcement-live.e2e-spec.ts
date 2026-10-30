import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const enabled = process.env.RUN_MODERATION_ENFORCEMENT_LIVE === '1';
type Account = { id: string; cookie: string };
(enabled ? describe : describe.skip)(
  'Stage 2E real auth, Kafka, inference and enforcement HTTP',
  () => {
    jest.setTimeout(180000);
    const base = 'http://localhost:3300';
    let db: Client;
    let author: Account;
    let reporter: Account;
    let moderator: Account;
    let reviewer: Account;
    async function request(
      account: Account | null,
      path: string,
      body?: unknown,
      method = body === undefined ? 'GET' : 'POST',
    ) {
      const response = await fetch(base + path, {
        method,
        headers: {
          ...(account ? { cookie: account.cookie } : {}),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const value: unknown = await response.json();
      return { status: response.status, value };
    }
    async function create(
      role: 'USER' | 'PLATFORM_MODERATOR' | 'ADMIN' = 'USER',
    ) {
      const response = await fetch(base + '/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Isolated integration user',
          email: `stage2e-${randomUUID()}@example.invalid`,
          password: randomUUID() + '!Aa42',
        }),
      });
      if (!response.ok)
        throw new Error(`Test account creation failed (${response.status})`);
      const value = (await response.json()) as { user: { id: string } };
      const cookie = response.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; ');
      await db.query('UPDATE "user" SET role=$1, onboarded=true WHERE id=$2', [
        role,
        value.user.id,
      ]);
      return { id: value.user.id, cookie };
    }
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL || '');
      if (
        url.hostname !== 'localhost' ||
        url.port !== '55432' ||
        url.pathname !== '/stage2e_test'
      )
        throw new Error('Dedicated Stage 2E database required');
      db = new Client({ connectionString: url.toString() });
      await db.connect();
      author = await create();
      reporter = await create();
      moderator = await create('PLATFORM_MODERATOR');
      reviewer = await create('PLATFORM_MODERATOR');
    });
    afterAll(async () => {
      await db?.end();
    });
    it('executes the real report → Hugging Face → policy → enforcement → sanction → appeal recovery flow', async () => {
      const created = await request(author, '/posts', {
        title: 'Quoted game dialogue for review',
        content:
          'You are an idiot. This is a quotation from a fictional battle; moderators should review the context.',
        visibility: 'PUBLIC',
      });
      expect(created.status).toBe(201);
      const postId = (created.value as { id: string }).id;
      const report = await request(reporter, '/reports', {
        targetType: 'POST',
        targetId: postId,
        reasonCode: 'HARASSMENT',
        details:
          'Please check whether this quoted dialogue is appropriately presented.',
      });
      expect(report.status).toBe(201);
      const cases = await db.query<{ id: string }>(
        'SELECT id FROM moderation_cases WHERE "targetId"=$1',
        [postId],
      );
      const caseId = cases.rows[0].id;
      const deadline = Date.now() + 120000;
      let advisory: { state: string } = { state: 'NO_ANALYSIS' };
      while (Date.now() < deadline) {
        const detail = await request(moderator, `/moderation/cases/${caseId}`);
        expect(detail.status).toBe(200);
        advisory = (detail.value as { aiAdvisory: typeof advisory }).aiAdvisory;
        if (advisory.state === 'CURRENT') break;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      expect(advisory.state).toBe('CURRENT');
      const model = await db.query<{
        profile: string;
        status: string;
        policy: string;
      }>(
        'SELECT a."classifierProfile" AS profile, a.status, e.status AS policy FROM moderation_analyses a JOIN moderation_policy_evaluations e ON e."analysisId"=a.id WHERE a."caseId"=$1',
        [caseId],
      );
      expect(model.rows[0]).toMatchObject({
        profile: 'toxicity-mmbert-small-v1',
        status: 'SUCCEEDED',
        policy: 'SUCCEEDED',
      });
      const endpoint = `/moderation/enforcement/cases/${caseId}`;
      expect(
        (
          await request(moderator, endpoint + '/content', {
            hidden: true,
            reason: 'Human review found a context problem',
          })
        ).status,
      ).toBe(201);
      expect((await request(reporter, `/posts/${postId}`)).status).toBe(404);
      const feed = await request(null, '/posts');
      expect(JSON.stringify(feed.value)).not.toContain(postId);
      expect(
        (await request(moderator, `/moderation/cases/${caseId}`)).status,
      ).toBe(200);
      const confirmed = await request(moderator, endpoint + '/violations', {
        category: 'HARASSMENT',
        severity: 'MODERATE',
        reason: 'Human finding after reading the complete evidence',
      });
      expect(confirmed.status).toBe(201);
      const violationId = (confirmed.value as { id: string }).id;
      const hide = await db.query<{ id: string }>(
        'SELECT id FROM content_enforcements WHERE "caseId"=$1 AND "revokedAt" IS NULL',
        [caseId],
      );
      const body = {
        type: 'PLATFORM_SUSPENSION',
        durationDays: 3,
        reason: 'Human decision with an appeal available',
        requestKey: randomUUID(),
        violationId,
        enforcementId: hide.rows[0].id,
      };
      const sanctioned = await request(
        moderator,
        endpoint + '/sanctions',
        body,
      );
      expect(sanctioned.status).toBe(201);
      const sanctionId = (sanctioned.value as { id: string }).id;
      expect(
        (await request(moderator, endpoint + '/sanctions', body)).value,
      ).toMatchObject({ id: sanctionId });
      // Uses the author's original, pre-sanction session; no login or cache refresh can bypass it.
      expect(
        (
          await request(author, '/posts', {
            title: 'Bypass attempt',
            content: 'Blocked',
            visibility: 'PUBLIC',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(
            author,
            '/users/me',
            { name: 'Bypass profile write' },
            'PATCH',
          )
        ).status,
      ).toBe(403);
      expect((await request(author, '/me/moderation')).status).toBe(200);
      expect(
        (
          await request(author, '/api/auth/update-user', {
            name: 'Alternative profile bypass',
          })
        ).status,
      ).toBe(403);
      const appeal = await request(
        author,
        `/me/moderation/sanctions/${sanctionId}/appeal`,
        {
          statement:
            'Please reconsider the surrounding game quotation and fictional context.',
        },
      );
      expect(appeal.status).toBe(201);
      const appealId = (appeal.value as { id: string }).id;
      expect(
        (
          await request(
            moderator,
            `/moderation/enforcement/appeals/${appealId}/review`,
            {
              decision: 'ACCEPTED',
              reason: 'Own decision review must be refused',
            },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await request(
            reviewer,
            `/moderation/enforcement/appeals/${appealId}/review`,
            {
              decision: 'ACCEPTED',
              reason: 'The quotation was misunderstood',
              reverseViolation: true,
              restoreContent: true,
            },
          )
        ).status,
      ).toBe(201);
      expect((await request(reporter, `/posts/${postId}`)).status).toBe(200);
      const overview = await request(reviewer, endpoint);
      expect(overview.value).toMatchObject({ risk: { score: 0 } });
      expect(
        (
          await request(author, '/posts', {
            title: 'Recovered account',
            content: 'Now allowed',
            visibility: 'PUBLIC',
          })
        ).status,
      ).toBe(201);
      const notificationsDeadline = Date.now() + 15000;
      let notices = 0;
      while (Date.now() < notificationsDeadline) {
        const result = await db.query<{ count: string }>(
          'SELECT count(*) FROM notifications WHERE "recipientId"=$1 AND type=\'MODERATION_NOTICE\'',
          [author.id],
        );
        notices = Number(result.rows[0].count);
        if (notices >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      expect(notices).toBeGreaterThanOrEqual(2);
    });
    it('enforces warnings, every temporary duration and recovery through real HTTP sessions', async () => {
      const subject = await create();
      const admin = await create('ADMIN');
      const post = await request(subject, '/posts', {
        title: 'Sanction matrix fixture',
        content: 'Controlled disposable test content',
      });
      expect(post.status).toBe(201);
      const postId = (post.value as { id: string }).id;
      expect(
        (
          await request(reporter, '/reports', {
            targetType: 'POST',
            targetId: postId,
            reasonCode: 'OTHER',
          })
        ).status,
      ).toBe(201);
      const caseId = (
        await db.query<{ id: string }>(
          'SELECT id FROM moderation_cases WHERE "targetId"=$1',
          [postId],
        )
      ).rows[0].id;
      const endpoint = `/moderation/enforcement/cases/${caseId}/sanctions`;
      for (const status of ['BANNED', 'SUSPENDED'])
        expect(
          (
            await request(
              admin,
              `/admin/users/${subject.id}/status`,
              { status, reason: 'MVP must reject indefinite legacy actions' },
              'PATCH',
            )
          ).status,
        ).toBe(400);
      expect(
        (
          await db.query<{ status: string }>(
            'SELECT status FROM "user" WHERE id=$1',
            [subject.id],
          )
        ).rows[0].status,
      ).toBe('ACTIVE');
      await db.query(`UPDATE "user" SET status='BANNED' WHERE id=$1`, [
        subject.id,
      ]);
      expect(
        (
          await request(
            admin,
            `/admin/users/${subject.id}/status`,
            { status: 'ACTIVE', reason: 'Review preserved legacy restriction' },
            'PATCH',
          )
        ).status,
      ).toBe(200);
      for (const invalid of [
        { type: 'PERMANENT_BAN' },
        { type: 'PLATFORM_READ_ONLY', durationDays: 7 },
        { type: 'PLATFORM_SUSPENSION' },
        { type: 'PLATFORM_SUSPENSION', durationDays: null },
        { type: 'PLATFORM_SUSPENSION', durationDays: 0 },
        { type: 'PLATFORM_SUSPENSION', durationDays: 31 },
        { type: 'PLATFORM_SUSPENSION', durationDays: 365 },
        { type: 'PLATFORM_SUSPENSION', durationDays: 7, expiresAt: null },
      ])
        expect(
          (
            await request(admin, endpoint, {
              ...invalid,
              reason: 'Unsupported MVP request',
              requestKey: randomUUID(),
            })
          ).status,
        ).toBe(400);
      for (const [type, days] of [
        ['WARNING', undefined],
        ['PLATFORM_SUSPENSION', 1],
        ['PLATFORM_SUSPENSION', 3],
        ['PLATFORM_SUSPENSION', 7],
        ['PLATFORM_SUSPENSION', 30],
        ['PLATFORM_SUSPENSION', 11],
      ] as const) {
        const body = {
          type,
          ...(days ? { durationDays: days } : {}),
          reason: 'Controlled authorization and duration verification',
          requestKey: randomUUID(),
        };
        const privileged = days === 11;
        if (privileged)
          expect(
            (
              await request(moderator, endpoint, {
                ...body,
                requestKey: randomUUID(),
              })
            ).status,
          ).toBe(400);
        const issued = await request(
          privileged ? admin : moderator,
          endpoint,
          body,
        );
        expect(issued.status).toBe(201);
        const record = issued.value as {
          id: string;
          startsAt: string;
          expiresAt: string | null;
        };
        if (days)
          expect(
            Date.parse(record.expiresAt!) - Date.parse(record.startsAt),
          ).toBe(days * 86400000);
        if (days === 7) {
          expect(
            (
              await request(reviewer, '/reports', {
                targetType: 'POST',
                targetId: postId,
                reasonCode: 'HARASSMENT',
              })
            ).status,
          ).toBe(201);
          expect(
            (
              await request(
                moderator,
                `/moderation/enforcement/cases/${caseId}/violations`,
                {
                  category: 'HARASSMENT',
                  severity: 'CRITICAL',
                  reason:
                    'Explicit finding changes risk, not sanction duration',
                },
              )
            ).status,
          ).toBe(201);
          const persisted = await db.query<{ expiresAt: Date }>(
            `SELECT ("expiresAt" AT TIME ZONE 'UTC') AS "expiresAt" FROM moderation_sanctions WHERE id=$1`,
            [record.id],
          );
          expect(persisted.rows[0].expiresAt.toISOString()).toBe(
            record.expiresAt,
          );
        }
        const read = await request(subject, `/posts/${postId}`);
        expect(read.status).toBe(type === 'PLATFORM_SUSPENSION' ? 403 : 200);
        expect(
          (await request(subject, `/posts/${postId}/like`, {})).status,
        ).toBe(type === 'WARNING' ? 201 : 403);
        expect((await request(subject, '/me/moderation')).status).toBe(200);
        if (days === 1) {
          await db.query(
            `UPDATE moderation_sanctions SET "startsAt"=now()-interval '3 days', "expiresAt"=now()-interval '1 day' WHERE id=$1`,
            [record.id],
          );
          expect(
            (await request(subject, `/posts/${postId}/like`, {})).status,
          ).toBe(201);
        }
        expect(
          (
            await request(
              privileged ? admin : moderator,
              `/moderation/enforcement/sanctions/${record.id}/revoke`,
              { reason: 'Controlled verification finished' },
            )
          ).status,
        ).toBe(201);
        expect((await request(subject, `/posts/${postId}`)).status).toBe(200);
      }
    });

    it('enforces community restrictions through writes, direct reads and aggregate feed hydration', async () => {
      const subject = await create();
      const community = await create();
      const gameId = randomUUID();
      const slug = `stage2e-http-${randomUUID()}`;
      await db.query(
        'INSERT INTO games (id,name,slug,"updatedAt") VALUES ($1,$2,$3,now())',
        [gameId, 'Isolated HTTP community', slug],
      );
      await db.query(
        'INSERT INTO game_moderators (id,"gameId","userId") VALUES ($1,$2,$3)',
        [randomUUID(), gameId, community.id],
      );
      const post = await request(subject, '/posts', {
        gameId,
        title: 'Community boundary fixture',
        content: 'Controlled disposable community content',
      });
      expect(post.status).toBe(201);
      const postId = (post.value as { id: string }).id;
      expect(
        (
          await request(reporter, '/reports', {
            targetType: 'POST',
            targetId: postId,
            reasonCode: 'OTHER',
          })
        ).status,
      ).toBe(201);
      const caseId = (
        await db.query<{ id: string }>(
          'SELECT id FROM moderation_cases WHERE "targetId"=$1',
          [postId],
        )
      ).rows[0].id;
      const scope = `?gameSlug=${slug}`;
      const endpoint = `/moderation/enforcement/cases/${caseId}/sanctions`;
      expect(
        (
          await request(community, endpoint + scope, {
            type: 'PLATFORM_SUSPENSION',
            durationDays: 1,
            reason: 'Must reject platform scope escalation',
            requestKey: randomUUID(),
          })
        ).status,
      ).toBe(403);
      for (const type of ['COMMUNITY_RESTRICTION', 'COMMUNITY_BAN']) {
        const issued = await request(community, endpoint + scope, {
          type,
          durationDays: 3,
          reason: 'Controlled community boundary verification',
          requestKey: randomUUID(),
        });
        expect(issued.status).toBe(201);
        expect(
          (await request(subject, `/posts/${postId}/like`, {})).status,
        ).toBe(403);
        expect(
          (
            await request(subject, `/posts/${postId}/comments`, {
              content: 'Blocked participation',
            })
          ).status,
        ).toBe(403);
        expect(
          (await request(subject, `/posts/${postId}?gameSlug=unrelated`))
            .status,
        ).toBe(type === 'COMMUNITY_BAN' ? 403 : 200);
        expect(
          (
            await request(subject, '/posts', {
              content: 'Other communities and personal posts remain usable',
            })
          ).status,
        ).toBe(201);
        if (type === 'COMMUNITY_BAN') {
          expect((await request(subject, `/games/${slug}/feed`)).status).toBe(
            403,
          );
          for (const path of [
            '/posts?search=Community%20boundary%20fixture',
            '/feed/latest',
            '/feed/trending',
          ]) {
            const feed = await request(subject, path);
            expect(feed.status).toBe(200);
            expect(JSON.stringify(feed.value)).not.toContain(postId);
          }
          expect((await request(reporter, `/posts/${postId}`)).status).toBe(
            200,
          );
        }
        expect(
          (
            await request(
              community,
              `/moderation/enforcement/sanctions/${(issued.value as { id: string }).id}/revoke${scope}`,
              { reason: 'Controlled scope verification finished' },
            )
          ).status,
        ).toBe(201);
      }
    });
  },
);
