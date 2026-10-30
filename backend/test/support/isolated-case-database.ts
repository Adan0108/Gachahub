import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { TRANSACTION_OPTIONS } from '../../src/prisma/prisma.service';

/** Test-only schema: never deploy checkout migrations over an unrelated shared DB history. */
export async function isolatedCaseDatabase(onQuery?: (query: string) => void) {
  const schema = `case_test_${randomUUID().replaceAll('-', '')}`;
  if (!/^case_test_[a-f0-9]{32}$/.test(schema))
    throw new Error('Invalid test schema');
  const root = resolve(__dirname, '../..');
  const generated = spawnSync(
    process.execPath,
    [
      resolve(root, 'node_modules/prisma/build/index.js'),
      'migrate',
      'diff',
      '--from-empty',
      '--to-schema',
      resolve(root, 'prisma/schema.prisma'),
      '--script',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  if (generated.status !== 0)
    throw new Error(`Test schema generation failed: ${generated.stderr}`);
  const ddl = generated.stdout
    .replace('CREATE SCHEMA IF NOT EXISTS "public";', '')
    .replace(/, 'CASE_(?:CLAIMED|RESOLVED|DISMISSED)'/g, '')
    .replace(/, 'MODERATION_CASE'/g, '')
    .replace(/, 'CASE_ASSIGNED'/g, '')
    .replace(/^\s*"lastReportedAt"[^\n]*\n/gm, '')
    .split(';')
    .filter(
      (statement) =>
        !/moderation_analyses|ModerationAnalysisStatus|moderation_policy_evaluations|ModerationPolicy/.test(
          statement,
        ) &&
        !statement.includes(
          'CREATE INDEX "moderation_cases_lastReportedAt_id_idx"',
        ) &&
        !statement.includes(
          'CREATE INDEX "moderation_cases_gameId_status_lastReportedAt_id_idx"',
        ),
    )
    .join(';');
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error('DATABASE_URL required for isolated PostgreSQL tests');
  const admin = new Client({
    connectionString,
    connectionTimeoutMillis: 15_000,
  });
  await admin.connect();
  try {
    await admin.query('BEGIN');
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET LOCAL search_path TO "${schema}", public`);
    await admin.query(ddl);
    // Prisma's schema diff cannot express the Game deletion trigger/check.
    // Reuse that migration's custom SQL after its schema-modeled FK changes.
    const personalPostMigration = readFileSync(
      resolve(
        root,
        'prisma/migrations/20261015050000_make_post_game_optional/migration.sql',
      ),
      'utf8',
    );
    await admin.query(
      personalPostMigration
        .slice(personalPostMigration.indexOf('CREATE FUNCTION'))
        .replace(/COMMIT;\s*$/, ''),
    );
    await admin.query(
      readFileSync(
        resolve(
          root,
          'prisma/migrations/20261015060000_add_open_moderation_case_unique/migration.sql',
        ),
        'utf8',
      ),
    );
    // Exercise the actual additive audit migration against the pre-change enum shape.
    await admin.query(
      readFileSync(
        resolve(
          root,
          'prisma/migrations/20261020000000_case_workflow_audit/migration.sql',
        ),
        'utf8',
      ),
    );
    await admin.query(
      readFileSync(
        resolve(
          root,
          'prisma/migrations/20261021000000_moderation_analysis_requests/migration.sql',
        ),
        'utf8',
      ),
    );
    await admin.query(
      readFileSync(
        resolve(
          root,
          'prisma/migrations/20261021100000_case_review_fixes/migration.sql',
        ),
        'utf8',
      ),
    );
    await admin.query(
      readFileSync(
        resolve(
          root,
          'prisma/migrations/20261022042915_moderation_analysis_results/migration.sql',
        ),
        'utf8',
      ),
    );
    // Apply the real policy migration so custom CHECK constraints are tested too.
    await admin.query(
      readFileSync(
        resolve(
          root,
          'prisma/migrations/20261028000000_add_moderation_policy_evaluations/migration.sql',
        ),
        'utf8',
      ),
    );
    await admin.query('COMMIT');
  } catch (error) {
    await admin.query('ROLLBACK');
    throw error;
  } finally {
    await admin.end();
  }
  const url = new URL(connectionString);
  // Neon transaction pooling rejects startup search_path; the same project has a direct endpoint.
  if (url.hostname.endsWith('.neon.tech'))
    url.hostname = url.hostname.replace('-pooler.', '.');
  // Modeled queries use adapter schema; raw locking queries use connection search_path.
  url.searchParams.set('options', `-c search_path=${schema},public`);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url.toString() }, { schema }),
    transactionOptions: TRANSACTION_OPTIONS,
    log: [{ level: 'query', emit: 'event' }],
  });
  if (onQuery) prisma.$on('query', (event) => onQuery(event.query));
  Object.assign(prisma, {
    onModuleInit: () => prisma.$connect(),
    onModuleDestroy: () => prisma.$disconnect(),
  });
  return {
    prisma,
    async cleanup() {
      await prisma.$disconnect();
      const cleanup = new Client({
        connectionString,
        connectionTimeoutMillis: 15_000,
      });
      await cleanup.connect();
      try {
        await cleanup.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await cleanup.end();
      }
    },
  };
}
