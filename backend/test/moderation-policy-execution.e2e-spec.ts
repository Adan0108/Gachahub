import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProcessedEventRepository } from '../src/notifications/processed-event.repository';
import { ModerationResultService } from '../src/moderation-analysis/moderation-result.service';
import { ModerationPolicyRepository } from '../src/moderation-policy/moderation-policy.repository';
import {
  ModerationPolicyRunner,
  persistedPolicyInput,
} from '../src/moderation-policy/moderation-policy-runner.service';
import { ModerationPolicyService } from '../src/moderation-policy/moderation-policy.service';
import {
  POLICY_MAX_ATTEMPTS,
  POLICY_RECONCILE_BATCH_SIZE,
} from '../src/moderation-policy/moderation-policy-execution.constants';
import { getModerationPolicyClassifierProfile } from '../src/moderation-policy/moderation-policy.profiles';
import { isolatedCaseDatabase } from './support/isolated-case-database';
import { resultFixture } from './support/moderation-result-fixture';

describe('Stage 2D.3 durable policy execution (isolated PostgreSQL)', () => {
  jest.setTimeout(120_000);
  let isolated: Awaited<ReturnType<typeof isolatedCaseDatabase>>;
  let db: PrismaService;
  let repository: ModerationPolicyRepository;
  let ingestion: ModerationResultService;
  const policy = new ModerationPolicyService();
  beforeAll(async () => {
    isolated = await isolatedCaseDatabase();
    db = isolated.prisma as PrismaService;
    repository = new ModerationPolicyRepository(db);
    ingestion = new ModerationResultService(
      db,
      new ProcessedEventRepository(),
      repository,
    );
  });
  beforeEach(async () => {
    await db.moderationCase.deleteMany();
  });
  afterAll(async () => {
    await isolated?.cleanup();
  });

  async function job() {
    return db.moderationAnalysis.create({
      data: {
        targetType: 'POST',
        targetId: randomUUID(),
        generation: 1,
        inputSchemaVersion: 1,
        inputSnapshot: {
          type: 'POST',
          title: null,
          content: 'private fixture content',
        },
        snapshotHash: `sha256:${'a'.repeat(64)}`,
        classifierProfile: 'toxicity-mmbert-small-v1',
        case: { create: { targetType: 'POST', targetId: randomUUID() } },
      },
    });
  }
  async function accepted() {
    const analysis = await job();
    const event = resultFixture(analysis);
    if (event.payload.status !== 'SUCCEEDED')
      throw new Error('Invalid fixture');
    const profile = getModerationPolicyClassifierProfile(
      analysis.classifierProfile,
    )!;
    event.payload.output = {
      model: { ...profile.model },
      labels: profile.labels.map((label) => ({
        label,
        score: label === 'threat' ? 0.74 : 0,
      })),
    };
    await ingestion.ingest(event);
    return { analysis, event };
  }
  function runner(evaluator = policy) {
    return new ModerationPolicyRunner(repository, evaluator);
  }
  async function evaluation() {
    return db.moderationPolicyEvaluation.findFirstOrThrow();
  }
  async function expire(id: string) {
    await db.$executeRaw`UPDATE moderation_policy_evaluations SET "leaseExpiresAt" = (statement_timestamp() AT TIME ZONE 'UTC') - interval '1 second' WHERE id = ${id}`;
  }
  async function makeDue(id: string) {
    await db.$executeRaw`UPDATE moderation_policy_evaluations SET "nextAttemptAt" = NULL WHERE id = ${id}`;
  }

  it('atomically enqueues successful work and deduplicates both event and logical-result replays', async () => {
    const { analysis, event } = await accepted();
    await ingestion.ingest(event);
    await ingestion.ingest({ ...event, eventId: randomUUID() });
    expect(await db.moderationPolicyEvaluation.count()).toBe(1);
    expect(await evaluation()).toMatchObject({
      analysisId: analysis.id,
      status: 'PENDING',
      attemptCount: 0,
    });
  });
  it('does not enqueue failed classifier results', async () => {
    const analysis = await job();
    const event = resultFixture(analysis);
    event.payload = {
      analysisJobId: analysis.id,
      caseId: analysis.caseId,
      generation: 1,
      snapshotHash: analysis.snapshotHash,
      classifierProfile: analysis.classifierProfile,
      status: 'FAILED',
      completedAt: event.occurredAt,
      errorCode: 'CLASSIFIER_ERROR',
    };
    await ingestion.ingest(event);
    expect(await db.moderationPolicyEvaluation.count()).toBe(0);
  });
  it('rolls back claim, terminal result and policy work when enqueue fails, then accepts replay', async () => {
    const analysis = await job();
    const event = resultFixture(analysis);
    await db.$executeRawUnsafe(
      `CREATE FUNCTION reject_policy_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$`,
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER reject_policy_fixture BEFORE INSERT ON moderation_policy_evaluations FOR EACH ROW EXECUTE FUNCTION reject_policy_fixture()',
    );
    try {
      await expect(ingestion.ingest(event)).rejects.toThrow();
    } finally {
      await db.$executeRawUnsafe(
        'DROP TRIGGER reject_policy_fixture ON moderation_policy_evaluations',
      );
    }
    expect(
      await db.processedEvent.count({
        where: { eventId: event.eventId, consumer: 'moderation-results' },
      }),
    ).toBe(0);
    expect(
      await db.moderationAnalysis.findUniqueOrThrow({
        where: { id: analysis.id },
      }),
    ).toMatchObject({ status: 'PENDING', result: null });
    expect(await db.moderationPolicyEvaluation.count()).toBe(0);
    await ingestion.ingest(event);
    expect(await db.moderationPolicyEvaluation.count()).toBe(1);
  });
  async function pendingClaim() {
    const claim = await repository.claimNext();
    if (!claim || 'exhausted' in claim)
      throw new Error('Expected pending leased work');
    return claim;
  }
  it('claims once concurrently, recovers expiry, fences all stale-token writes and permits the current token', async () => {
    await accepted();
    const claims = await Promise.all([
      repository.claimNext(),
      repository.claimNext(),
    ]);
    const first = claims.find((claim) => claim !== null)!;
    if ('exhausted' in first) throw new Error('Expected pending leased work');
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(first.attemptCount).toBe(1);
    expect(await repository.claimNext()).toBeNull();
    await expire(first.id);
    const output = policy.evaluate(
      persistedPolicyInput(
        'toxicity-mmbert-small-v1',
        (await repository.loadAnalysis(first.analysisId))!.result,
      ),
    );
    expect(await repository.succeed(first, output)).toBe(false);
    const second = await pendingClaim();
    expect(second.leaseToken).not.toBe(first.leaseToken);
    expect(second.attemptCount).toBe(2);
    expect(await repository.succeed(first, output)).toBe(false);
    expect(await repository.unsupported(first)).toBe(false);
    expect(await repository.retry(first)).toBe(false);
    expect(await repository.succeed(second, output)).toBe(true);
    expect(await repository.retry(second)).toBe(false);
  });
  it('evaluates persisted production scores exactly as the pure evaluator without mutating source/case', async () => {
    const { analysis } = await accepted();
    const before = await db.moderationAnalysis.findUniqueOrThrow({
      where: { id: analysis.id },
    });
    const caseBefore = await db.moderationCase.findUniqueOrThrow({
      where: { id: analysis.caseId },
    });
    const expected = policy.evaluate(
      persistedPolicyInput(before.classifierProfile, before.result),
    );
    expect(await runner().processNext()).toBe(true);
    expect(await evaluation()).toMatchObject({
      ...expected,
      status: 'SUCCEEDED',
      leaseToken: null,
      leaseExpiresAt: null,
      errorCode: null,
    });
    expect((await evaluation()).evaluatedAt).toBeInstanceOf(Date);
    expect(
      await db.moderationAnalysis.findUniqueOrThrow({
        where: { id: analysis.id },
      }),
    ).toEqual(before);
    expect(
      await db.moderationCase.findUniqueOrThrow({
        where: { id: analysis.caseId },
      }),
    ).toEqual(caseBefore);
  });
  it.each(['fixture', 'model', 'revision', 'missing', 'extra', 'duplicate'])(
    'finalizes unsupported %s evidence without retrying or changing classifier status',
    async (kind) => {
      const { analysis } = await accepted();
      const loaded = (await repository.loadAnalysis(analysis.id))!;
      const stored = loaded.result as {
        output: {
          model: { name: string; revision: string };
          labels: Array<{ label: string; score: number }>;
        };
      };
      if (kind === 'model') stored.output.model.name = 'wrong';
      if (kind === 'revision') stored.output.model.revision = 'main';
      if (kind === 'missing') stored.output.labels.pop();
      if (kind === 'extra')
        stored.output.labels.push({ label: 'extra', score: 0 });
      if (kind === 'duplicate')
        stored.output.labels.push(stored.output.labels[0]);
      await db.moderationAnalysis.update({
        where: { id: analysis.id },
        data: {
          result: stored,
          ...(kind === 'fixture'
            ? { classifierProfile: 'moderation-text-v1' }
            : {}),
        },
      });
      await runner().processNext();
      expect(await evaluation()).toMatchObject({
        status: 'UNSUPPORTED',
        errorCode: 'UNSUPPORTED_CLASSIFIER_EVIDENCE',
        riskLevel: null,
        priorityScore: null,
        signals: null,
        evaluatedAt: null,
        leaseToken: null,
      });
      expect((await repository.loadAnalysis(analysis.id))!.status).toBe(
        'SUCCEEDED',
      );
    },
  );
  it('retries internal failures with due-time gating, then exhausts without exposing details or changing inference', async () => {
    const { analysis } = await accepted();
    const before = await repository.loadAnalysis(analysis.id);
    const failing = new ModerationPolicyService();
    const evaluate = jest.spyOn(failing, 'evaluate').mockImplementation(() => {
      throw new Error('private fixture content and secret');
    });
    const worker = runner(failing);
    for (let attempt = 1; attempt <= POLICY_MAX_ATTEMPTS; attempt++) {
      await worker.processNext();
      const row = await evaluation();
      expect(row.attemptCount).toBe(attempt);
      expect(row.status).toBe(
        attempt === POLICY_MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
      );
      expect(row.errorCode).toBe('POLICY_EVALUATION_ERROR');
      expect(row.signals).toBeNull();
      expect(row.leaseToken).toBeNull();
      if (attempt < POLICY_MAX_ATTEMPTS) {
        expect(row.nextAttemptAt).toBeInstanceOf(Date);
        expect(await repository.claimNext()).toBeNull();
        await makeDue(row.id);
      }
    }
    expect(evaluate).toHaveBeenCalledTimes(POLICY_MAX_ATTEMPTS);
    expect(await repository.claimNext()).toBeNull();
    expect(await repository.loadAnalysis(analysis.id)).toEqual(before);
    expect(JSON.stringify(await evaluation())).not.toContain('private');
  });
  it('exhausts a lease repeatedly abandoned by crashed runners without exceeding the attempt limit', async () => {
    await accepted();
    for (let index = 0; index < POLICY_MAX_ATTEMPTS; index++) {
      const claim = await pendingClaim();
      await expire(claim.id);
    }
    expect(await repository.claimNext()).toEqual({ exhausted: true });
    expect(await evaluation()).toMatchObject({
      status: 'FAILED',
      attemptCount: POLICY_MAX_ATTEMPTS,
      errorCode: 'POLICY_ATTEMPTS_EXHAUSTED',
      leaseToken: null,
    });
  });
  it('continues within the same batch after finalizing an exhausted oldest candidate', async () => {
    const first = await accepted();
    const second = await accepted();
    await db.moderationPolicyEvaluation.updateMany({
      where: { analysisId: first.analysis.id },
      data: {
        attemptCount: POLICY_MAX_ATTEMPTS,
        nextAttemptAt: null,
        leaseExpiresAt: null,
      },
    });
    const worker = runner();
    expect(await worker.processNext()).toBe(true);
    expect(await worker.processNext()).toBe(true);
    expect(
      await db.moderationPolicyEvaluation.findFirst({
        where: { analysisId: second.analysis.id },
      }),
    ).toMatchObject({ status: 'SUCCEEDED' });
  });
  it('reconciles bounded PK pages, skips failed/pending analyses, and is idempotent under concurrent backfill', async () => {
    const first = await accepted();
    await db.moderationPolicyEvaluation.deleteMany();
    await db.moderationAnalysis.createMany({
      data: Array.from({ length: POLICY_RECONCILE_BATCH_SIZE }, (_, index) => ({
        id: `reconcile_${String(index).padStart(4, '0')}`,
        caseId: first.analysis.caseId,
        targetType: 'POST',
        targetId: first.analysis.targetId,
        generation: index + 2,
        inputSchemaVersion: 1,
        inputSnapshot: {},
        snapshotHash: `sha256:${index}`,
        classifierProfile: 'fixture',
        status: index === 0 ? 'FAILED' : 'SUCCEEDED',
      })),
    });
    const cursors = await Promise.all([
      repository.reconcile(),
      repository.reconcile(),
    ]);
    expect(cursors[0]).toBeDefined();
    expect(await db.moderationPolicyEvaluation.count()).toBe(
      POLICY_RECONCILE_BATCH_SIZE - 1,
    );
    expect(await repository.reconcile(cursors[0])).toBeUndefined();
    expect(await db.moderationPolicyEvaluation.count()).toBe(
      POLICY_RECONCILE_BATCH_SIZE,
    );
    await repository.reconcile();
    expect(await db.moderationPolicyEvaluation.count()).toBe(
      POLICY_RECONCILE_BATCH_SIZE,
    );
  });
});
