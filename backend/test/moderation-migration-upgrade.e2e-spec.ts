import {
  cpSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const enabled = process.env.RUN_MODERATION_MIGRATION_TESTS === '1';
(enabled ? describe : describe.skip)(
  'Stage 2E versioned migration upgrade preserves existing data',
  () => {
    jest.setTimeout(180000);
    it('upgrades all shared migrations, backfills legacy hides conservatively and enforces SQL constraints', async () => {
      const base = new URL(process.env.DATABASE_URL || '');
      if (
        base.hostname !== 'localhost' ||
        base.port !== '55432' ||
        base.pathname !== '/stage2e_test'
      )
        throw new Error('Dedicated Stage 2E database required');
      const database = `stage2e_upgrade_${randomUUID().replaceAll('-', '')}`;
      if (!/^stage2e_upgrade_[a-f0-9]{32}$/.test(database))
        throw new Error('Unexpected test database name');
      const root = resolve(__dirname, '..');
      const temp = mkdtempSync(join(tmpdir(), 'gachahub-stage2e-migrations-'));
      const absolute = resolve(temp);
      if (
        !absolute.startsWith(resolve(tmpdir()) + sep) ||
        !basename(absolute).startsWith('gachahub-stage2e-migrations-')
      )
        throw new Error('Unexpected test artifact path');
      const migrations = join(temp, 'migrations');
      const config = join(temp, 'prisma.config.ts');
      const admin = new Client({ connectionString: base.toString() });
      await admin.connect();
      let created = false;
      let fixture: Client | undefined;
      const url = new URL(base);
      url.pathname = '/' + database;
      const deploy = () => {
        const result = spawnSync(
          process.execPath,
          [
            resolve(root, 'node_modules/prisma/build/index.js'),
            'migrate',
            'deploy',
            '--config',
            config,
          ],
          {
            cwd: root,
            encoding: 'utf8',
            env: { ...process.env, DATABASE_URL: url.toString() },
            timeout: 90000,
          },
        );
        if (result.status !== 0)
          throw new Error(
            `Isolated migration deploy failed (exit ${result.status})`,
          );
      };
      try {
        await admin.query(`CREATE DATABASE "${database}"`);
        created = true;
        cpSync(
          resolve(root, 'prisma/migrations/migration_lock.toml'),
          join(migrations, 'migration_lock.toml'),
          { recursive: true },
        );
        for (const entry of readdirSync(resolve(root, 'prisma/migrations'), {
          withFileTypes: true,
        })) {
          if (entry.isDirectory() && entry.name < '20261030')
            cpSync(
              resolve(root, 'prisma/migrations', entry.name),
              join(migrations, entry.name),
              { recursive: true },
            );
        }
        writeFileSync(
          config,
          `import { defineConfig } from ${JSON.stringify(resolve(root, 'node_modules/prisma/config.js').replaceAll('\\', '/'))};\nexport default defineConfig({ schema: ${JSON.stringify(resolve(root, 'prisma/schema.prisma'))}, migrations: { path: ${JSON.stringify(migrations)} }, datasource: { url: process.env.DATABASE_URL } });\n`,
        );
        deploy();
        fixture = new Client({ connectionString: url.toString() });
        await fixture.connect();
        await fixture.query(
          `INSERT INTO "user" (id,name,email,"updatedAt") VALUES ('upgrade-author','Upgrade fixture','upgrade@example.invalid',now())`,
        );
        await fixture.query(
          `INSERT INTO "user" (id,name,email,status,"updatedAt") VALUES ('upgrade-legacy-banned','Legacy fixture','legacy-upgrade@example.invalid','BANNED',now())`,
        );
        await fixture.query(
          `INSERT INTO posts (id,title,content,"authorId",status,"updatedAt") VALUES ('upgrade-hidden','Legacy hidden','Keep this exact evidence','upgrade-author','HIDDEN',now()), ('upgrade-visible','Visible','Keep this visible','upgrade-author','PUBLISHED',now())`,
        );
        for (const entry of readdirSync(resolve(root, 'prisma/migrations'), {
          withFileTypes: true,
        })) {
          if (entry.isDirectory() && entry.name.startsWith('20261030'))
            cpSync(
              resolve(root, 'prisma/migrations', entry.name),
              join(migrations, entry.name),
              { recursive: true },
            );
        }
        deploy();
        expect(
          (
            await fixture.query(
              'SELECT id,status,content FROM posts ORDER BY id',
            )
          ).rows,
        ).toEqual([
          {
            id: 'upgrade-hidden',
            status: 'HIDDEN',
            content: 'Keep this exact evidence',
          },
          {
            id: 'upgrade-visible',
            status: 'PUBLISHED',
            content: 'Keep this visible',
          },
        ]);
        expect(
          (
            await fixture.query(
              'SELECT scope,"revokedAt" FROM content_enforcements',
            )
          ).rows,
        ).toEqual([{ scope: 'PLATFORM', revokedAt: null }]);
        await expect(
          fixture.query(
            `UPDATE posts SET status='PUBLISHED' WHERE id='upgrade-hidden'`,
          ),
        ).rejects.toThrow();
        await expect(
          fixture.query(
            `INSERT INTO moderation_sanctions(id,"subjectId",type,scope,reason,"updatedAt","requestKey","requestHash") VALUES ('invalid-temporary','upgrade-author','PLATFORM_SUSPENSION','PLATFORM','Test only',now(),'invalid-key','invalid-hash')`,
          ),
        ).rejects.toThrow();
        expect(
          (
            await fixture.query(
              `SELECT status FROM "user" WHERE id='upgrade-legacy-banned'`,
            )
          ).rows,
        ).toEqual([{ status: 'BANNED' }]);
        const sanctionTypes = await fixture.query<{ enumlabel: string }>(
          `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='SanctionType' ORDER BY e.enumsortorder`,
        );
        expect(sanctionTypes.rows.map((r) => r.enumlabel)).toEqual([
          'WARNING',
          'COMMUNITY_RESTRICTION',
          'COMMUNITY_BAN',
          'PLATFORM_SUSPENSION',
        ]);
        for (const days of [0, 31, 365]) {
          await expect(
            fixture.query(
              `INSERT INTO moderation_sanctions(id,"subjectId",type,scope,reason,"startsAt","expiresAt","updatedAt","requestKey","requestHash") VALUES ($1,'upgrade-author','PLATFORM_SUSPENSION','PLATFORM','Test only',now(),now()+($2 * interval '1 day'),now(),$1,'invalid-hash')`,
              [`invalid-${days}`, days],
            ),
          ).rejects.toThrow();
        }
        for (const type of ['PERMANENT_BAN', 'PLATFORM_READ_ONLY']) {
          await expect(
            fixture.query(
              `INSERT INTO moderation_sanctions(id,"subjectId",type,scope,reason,"updatedAt","requestKey","requestHash") VALUES ($1,'upgrade-author',$2,'PLATFORM','Test only',now(),$1,'invalid-hash')`,
              [`invalid-${type}`, type],
            ),
          ).rejects.toThrow();
        }
      } finally {
        await fixture?.end();
        if (created) await admin.query(`DROP DATABASE "${database}"`);
        await admin.end();
        rmSync(absolute, { recursive: true, force: true });
      }
    });
  },
);
