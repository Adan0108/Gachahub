import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../src/generated/prisma/client';
import { isolatedCaseDatabase } from './support/isolated-case-database';

describe('Stage 2D.1 policy migration constraints (isolated PostgreSQL schema)', () => {
  jest.setTimeout(120_000);
  let isolated: Awaited<ReturnType<typeof isolatedCaseDatabase>>;
  let analysisId: string;

  beforeAll(async () => {
    isolated = await isolatedCaseDatabase();
    const analysis = await isolated.prisma.moderationAnalysis.create({
      data: {
        targetType: 'POST',
        targetId: randomUUID(),
        generation: 1,
        inputSchemaVersion: 1,
        inputSnapshot: {},
        snapshotHash: `sha256:${'a'.repeat(64)}`,
        classifierProfile: 'moderation-text-v1',
        case: { create: { targetType: 'POST', targetId: randomUUID() } },
      },
    });
    analysisId = analysis.id;
  });
  afterAll(async () => {
    await isolated?.cleanup();
  });

  function create(
    patch: Partial<Prisma.ModerationPolicyEvaluationUncheckedCreateInput> = {},
  ) {
    return isolated.prisma.moderationPolicyEvaluation.create({
      data: { analysisId, policyVersion: randomUUID(), ...patch },
    });
  }
  const success = () => ({
    status: 'SUCCEEDED' as const,
    riskLevel: 'LOW' as const,
    priorityScore: 0,
    signals: [],
    evaluatedAt: new Date(),
  });

  it('defaults to empty PENDING and allows operational retry/lease metadata', async () => {
    expect(
      await create({
        leaseToken: 'claim',
        leaseExpiresAt: new Date(),
        nextAttemptAt: new Date(),
        attemptCount: 1,
      }),
    ).toMatchObject({
      status: 'PENDING',
      riskLevel: null,
      priorityScore: null,
      signals: null,
      evaluatedAt: null,
    });
  });
  it.each([0, 100])(
    'accepts complete SUCCEEDED output at priority %s',
    async (priorityScore) => {
      expect(await create({ ...success(), priorityScore })).toMatchObject({
        status: 'SUCCEEDED',
        priorityScore,
      });
    },
  );
  it.each([-1, 101])(
    'rejects priority outside bounds: %s',
    async (priorityScore) => {
      await expect(create({ ...success(), priorityScore })).rejects.toThrow();
    },
  );
  it.each(['riskLevel', 'priorityScore', 'signals', 'evaluatedAt'] as const)(
    'requires successful %s',
    async (field) => {
      await expect(
        create({
          ...success(),
          [field]: field === 'signals' ? Prisma.DbNull : null,
        }),
      ).rejects.toThrow();
    },
  );
  it.each([Prisma.JsonNull, {}, 'signal', 1])(
    'requires a JSON array for successful signals %#',
    async (signals) => {
      await expect(create({ ...success(), signals })).rejects.toThrow();
    },
  );
  describe.each(['PENDING', 'FAILED', 'UNSUPPORTED'] as const)(
    '%s output consistency',
    (status) => {
      it('allows no advisory output', async () => {
        expect(await create({ status })).toMatchObject({
          status,
          riskLevel: null,
          signals: null,
        });
      });
      it.each([
        { riskLevel: 'LOW' as const },
        { priorityScore: 10 },
        { signals: [] },
        { evaluatedAt: new Date() },
      ])('rejects advisory output %#', async (patch) => {
        await expect(create({ status, ...patch })).rejects.toThrow();
      });
    },
  );
  it('rejects negative attempts', async () => {
    await expect(create({ attemptCount: -1 })).rejects.toThrow();
  });
  it.each(['', 'lowercase', 'CODE WITH SPACE', 'X'.repeat(65)])(
    'rejects unsafe error code %#',
    async (errorCode) => {
      await expect(create({ status: 'FAILED', errorCode })).rejects.toThrow();
    },
  );
  it.each(['POLICY_ERROR', 'X'.repeat(64)])(
    'accepts bounded machine error code %#',
    async (errorCode) => {
      expect(await create({ status: 'FAILED', errorCode })).toMatchObject({
        errorCode,
      });
    },
  );
  it('rejects error code on successful output', async () => {
    await expect(
      create({ ...success(), errorCode: 'POLICY_ERROR' }),
    ).rejects.toThrow();
  });
  it('enforces analysis/version uniqueness while retaining different versions', async () => {
    const policyVersion = randomUUID();
    await create({ policyVersion });
    await expect(create({ policyVersion })).rejects.toThrow();
    await expect(
      create({ policyVersion: `${policyVersion}-v2` }),
    ).resolves.toBeDefined();
  });
  it('requires an existing analysis', async () => {
    await expect(create({ analysisId: randomUUID() })).rejects.toThrow();
  });
  it('cascades evaluation deletion with its owning analysis', async () => {
    const evaluation = await create();
    await isolated.prisma.moderationAnalysis.delete({
      where: { id: analysisId },
    });
    expect(
      await isolated.prisma.moderationPolicyEvaluation.findUnique({
        where: { id: evaluation.id },
      }),
    ).toBeNull();
  });
});
