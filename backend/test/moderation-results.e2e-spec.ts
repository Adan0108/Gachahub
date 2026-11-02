import { ModerationPolicyRepository } from '../src/moderation-policy/moderation-policy.repository';
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { ModerationResultService } from '../src/moderation-analysis/moderation-result.service';
import { ProcessedEventRepository } from '../src/notifications/processed-event.repository';
import { PrismaService } from '../src/prisma/prisma.service';
import { isolatedCaseDatabase } from './support/isolated-case-database';
import { resultFixture } from './support/moderation-result-fixture';

describe('Stage 2B real PostgreSQL', () => {
  jest.setTimeout(120_000);
  let isolated: Awaited<ReturnType<typeof isolatedCaseDatabase>>;
  let db: PrismaService;
  let service: ModerationResultService;
  beforeAll(async () => {
    isolated = await isolatedCaseDatabase();
    db = isolated.prisma as PrismaService;
    service = new ModerationResultService(
      db,
      new ProcessedEventRepository(),
      new ModerationPolicyRepository(db),
    );
  });
  afterAll(async () => {
    await isolated?.cleanup();
  });

  async function job(status: 'OPEN' | 'RESOLVED' | 'DISMISSED' = 'OPEN') {
    return db.moderationAnalysis.create({
      data: {
        targetType: 'POST',
        targetId: randomUUID(),
        generation: 1,
        inputSchemaVersion: 1,
        inputSnapshot: { type: 'POST', title: null, content: 'fixture' },
        snapshotHash: `sha256:${'a'.repeat(64)}`,
        classifierProfile: 'moderation-text-v1',
        case: {
          create: { targetType: 'POST', targetId: randomUUID(), status },
        },
      },
    });
  }
  async function claimCount(eventId: string) {
    return db.processedEvent.count({
      where: { eventId, consumer: 'moderation-results' },
    });
  }

  it('persists success, dedupes repeated event and different event IDs', async () => {
    const row = await job();
    const first = resultFixture(row);
    await service.ingest(first);
    const saved = await db.moderationAnalysis.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(saved.status).toBe('SUCCEEDED');
    expect(saved.result).toMatchObject({
      acceptedEventId: first.eventId,
      completedAt: first.payload.completedAt,
    });
    await service.ingest(first);
    const second = resultFixture(row);
    await service.ingest(second);
    expect(
      await db.moderationAnalysis.findUniqueOrThrow({ where: { id: row.id } }),
    ).toEqual(saved);
    expect(await claimCount(first.eventId)).toBe(1);
    expect(await claimCount(second.eventId)).toBe(1);
  });
  it('persists failure with no free-form details', async () => {
    const row = await job();
    const event = resultFixture(row);
    event.payload = {
      analysisJobId: row.id,
      caseId: row.caseId,
      generation: 1,
      snapshotHash: row.snapshotHash,
      classifierProfile: row.classifierProfile,
      status: 'FAILED',
      completedAt: event.occurredAt,
      errorCode: 'MODEL_TIMEOUT',
    };
    await service.ingest(event);
    expect(
      await db.moderationAnalysis.findUniqueOrThrow({ where: { id: row.id } }),
    ).toMatchObject({
      status: 'FAILED',
      result: {
        acceptedEventId: event.eventId,
        completedAt: event.occurredAt,
        errorCode: 'MODEL_TIMEOUT',
      },
    });
  });
  it.each([
    'generation',
    'snapshotHash',
    'classifierProfile',
    'caseId',
    'analysisJobId',
  ] as const)('claims but ignores unknown/mismatched %s', async (field) => {
    const row = await job();
    const event = resultFixture(row);
    if (field === 'generation') event.payload.generation++;
    else if (field === 'snapshotHash')
      event.payload.snapshotHash = `sha256:${'b'.repeat(64)}`;
    else event.payload[field] = 'unknown';
    if (field === 'caseId') event.aggregateId = event.payload.caseId;
    await service.ingest(event);
    expect(await claimCount(event.eventId)).toBe(1);
    expect(
      await db.moderationAnalysis.findUniqueOrThrow({ where: { id: row.id } }),
    ).toMatchObject({ status: 'PENDING', result: null });
  });
  it.each(['RESOLVED', 'DISMISSED'] as const)(
    'preserves %s case and completes old generation independently',
    async (status) => {
      const old = await job(status);
      const newer = await db.moderationAnalysis.create({
        data: {
          caseId: old.caseId,
          targetType: old.targetType,
          targetId: old.targetId,
          generation: 2,
          inputSchemaVersion: 1,
          inputSnapshot: {},
          snapshotHash: `sha256:${'b'.repeat(64)}`,
          classifierProfile: old.classifierProfile,
        },
      });
      const before = await db.moderationCase.findUniqueOrThrow({
        where: { id: old.caseId },
      });
      const auditCount = await db.auditLog.count();
      const outboxCount = await db.outboxEvent.count();
      await service.ingest(resultFixture(old));
      expect(
        await db.moderationCase.findUniqueOrThrow({
          where: { id: old.caseId },
        }),
      ).toEqual(before);
      expect(
        await db.moderationAnalysis.findUniqueOrThrow({
          where: { id: newer.id },
        }),
      ).toEqual(newer);
      expect(
        (
          await db.moderationAnalysis.findUniqueOrThrow({
            where: { id: old.id },
          })
        ).status,
      ).toBe('SUCCEEDED');
      expect(await db.auditLog.count()).toBe(auditCount);
      expect(await db.outboxEvent.count()).toBe(outboxCount);
    },
  );
  it('serializes competing terminal writes behind the authoritative case lock', async () => {
    const row = await job();
    const first = resultFixture(row);
    const second = resultFixture(row);
    second.payload = {
      ...second.payload,
      status: 'FAILED',
      errorCode: 'MODEL_TIMEOUT',
    };
    if ('output' in second.payload)
      delete (second.payload as { output?: unknown }).output;
    let release!: () => void;
    let locked!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM moderation_cases WHERE id = ${row.caseId} FOR UPDATE`;
      locked();
      await gate;
    });
    await ready;
    const pending = [service.ingest(first), service.ingest(second)];
    // Let both independent connections enter their transactions while the case is locked.
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(
        (
          await db.moderationAnalysis.findUniqueOrThrow({
            where: { id: row.id },
          })
        ).status,
      ).toBe('PENDING');
    } finally {
      release();
    }
    await holder;
    await Promise.all(pending);
    const saved = await db.moderationAnalysis.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(['SUCCEEDED', 'FAILED']).toContain(saved.status);
    const result = saved.result as { acceptedEventId: string };
    expect([first.eventId, second.eventId]).toContain(result.acceptedEventId);
    expect(saved.status).toBe(
      result.acceptedEventId === first.eventId ? 'SUCCEEDED' : 'FAILED',
    );
    expect(await claimCount(first.eventId)).toBe(1);
    expect(await claimCount(second.eventId)).toBe(1);
  });
  it('dedupes same event concurrently', async () => {
    const row = await job();
    const event = resultFixture(row);
    await Promise.all([service.ingest(event), service.ingest(event)]);
    expect(await claimCount(event.eventId)).toBe(1);
    expect(
      (await db.moderationAnalysis.findUniqueOrThrow({ where: { id: row.id } }))
        .status,
    ).toBe('SUCCEEDED');
  });
  it('rolls back claim and terminal write on persistence failure, then accepts replay', async () => {
    const row = await job();
    const event = resultFixture(row);
    // Real PostgreSQL failure after the UPDATE, with a schema-local trigger.
    await db.$executeRawUnsafe(
      `CREATE FUNCTION reject_result_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture persistence failure'; END $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER reject_result_fixture AFTER UPDATE ON moderation_analyses FOR EACH ROW EXECUTE FUNCTION reject_result_fixture()`,
    );
    try {
      await expect(service.ingest(event)).rejects.toThrow();
    } finally {
      await db.$executeRawUnsafe(
        'DROP TRIGGER reject_result_fixture ON moderation_analyses',
      );
    }
    expect(await claimCount(event.eventId)).toBe(0);
    expect(
      (await db.moderationAnalysis.findUniqueOrThrow({ where: { id: row.id } }))
        .status,
    ).toBe('PENDING');
    await service.ingest(event);
    expect(await claimCount(event.eventId)).toBe(1);
    expect(
      (await db.moderationAnalysis.findUniqueOrThrow({ where: { id: row.id } }))
        .status,
    ).toBe('SUCCEEDED');
  });
});
