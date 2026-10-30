import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { parseModerationPolicyOutput } from './moderation-policy.contract';
import {
  POLICY_LEASE_MS,
  POLICY_MAX_ATTEMPTS,
  POLICY_RECONCILE_BATCH_SIZE,
  policyRetryDelay,
} from './moderation-policy-execution.constants';
import {
  MODERATION_POLICY_VERSION_V1,
  type ModerationPolicyOutput,
} from './moderation-policy.types';

export interface PolicyClaim {
  id: string;
  analysisId: string;
  policyVersion: string;
  attemptCount: number;
  leaseToken: string;
}

@Injectable()
export class ModerationPolicyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async enqueueForAnalysis(
    tx: Prisma.TransactionClient,
    analysisId: string,
    policyVersion = MODERATION_POLICY_VERSION_V1,
  ): Promise<void> {
    await tx.moderationPolicyEvaluation.createMany({
      data: [{ analysisId, policyVersion }],
      skipDuplicates: true,
    });
  }

  async claimNext(): Promise<PolicyClaim | { exhausted: true } | null> {
    const token = randomUUID();
    const rows = await this.prisma.$queryRaw<
      Array<PolicyClaim & { status: string }>
    >`
      WITH candidate AS (
        SELECT id FROM moderation_policy_evaluations
        WHERE status = 'PENDING' AND "policyVersion" = ${MODERATION_POLICY_VERSION_V1}
          AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= statement_timestamp() AT TIME ZONE 'UTC')
          AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= statement_timestamp() AT TIME ZONE 'UTC')
        ORDER BY "nextAttemptAt" ASC NULLS FIRST, id
        LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      UPDATE moderation_policy_evaluations e SET
        status = CASE WHEN "attemptCount" >= ${POLICY_MAX_ATTEMPTS}
          THEN 'FAILED'::"ModerationPolicyEvaluationStatus" ELSE e.status END,
        "attemptCount" = CASE WHEN "attemptCount" >= ${POLICY_MAX_ATTEMPTS}
          THEN "attemptCount" ELSE "attemptCount" + 1 END,
        "leaseToken" = CASE WHEN "attemptCount" >= ${POLICY_MAX_ATTEMPTS} THEN NULL ELSE ${token} END,
        "leaseExpiresAt" = CASE WHEN "attemptCount" >= ${POLICY_MAX_ATTEMPTS} THEN NULL
          ELSE (statement_timestamp() AT TIME ZONE 'UTC') + ${POLICY_LEASE_MS} * interval '1 millisecond' END,
        "nextAttemptAt" = NULL,
        "errorCode" = CASE WHEN "attemptCount" >= ${POLICY_MAX_ATTEMPTS}
          THEN 'POLICY_ATTEMPTS_EXHAUSTED' ELSE "errorCode" END,
        "updatedAt" = statement_timestamp() AT TIME ZONE 'UTC'
      FROM candidate WHERE e.id = candidate.id
      RETURNING e.id, e."analysisId", e."policyVersion", e."attemptCount", e."leaseToken", e.status
    `;
    if (!rows.length) return null;
    return rows[0].status === 'PENDING' ? rows[0] : { exhausted: true };
  }

  loadAnalysis(analysisId: string) {
    return this.prisma.moderationAnalysis.findUnique({
      where: { id: analysisId },
      select: { status: true, classifierProfile: true, result: true },
    });
  }

  async succeed(
    claim: PolicyClaim,
    candidate: ModerationPolicyOutput,
  ): Promise<boolean> {
    const output = parseModerationPolicyOutput(candidate);
    const count = await this.prisma.$executeRaw`
      UPDATE moderation_policy_evaluations SET status = 'SUCCEEDED',
        "riskLevel" = ${output.riskLevel}::"ModerationPolicyRiskLevel",
        "priorityScore" = ${output.priorityScore}, signals = ${JSON.stringify(output.signals)}::jsonb,
        "evaluatedAt" = statement_timestamp() AT TIME ZONE 'UTC',
        "leaseToken" = NULL, "leaseExpiresAt" = NULL, "nextAttemptAt" = NULL, "errorCode" = NULL,
        "updatedAt" = statement_timestamp() AT TIME ZONE 'UTC'
      WHERE id = ${claim.id} AND status = 'PENDING' AND "leaseToken" = ${claim.leaseToken}
        AND "policyVersion" = ${output.policyVersion}
        AND "leaseExpiresAt" > statement_timestamp() AT TIME ZONE 'UTC'
    `;
    return count === 1;
  }

  async unsupported(claim: PolicyClaim): Promise<boolean> {
    return (
      (await this.prisma.$executeRaw`
      UPDATE moderation_policy_evaluations SET status = 'UNSUPPORTED',
        "errorCode" = 'UNSUPPORTED_CLASSIFIER_EVIDENCE',
        "leaseToken" = NULL, "leaseExpiresAt" = NULL, "nextAttemptAt" = NULL,
        "updatedAt" = statement_timestamp() AT TIME ZONE 'UTC'
      WHERE id = ${claim.id} AND status = 'PENDING' AND "leaseToken" = ${claim.leaseToken}
        AND "leaseExpiresAt" > statement_timestamp() AT TIME ZONE 'UTC'
    `) === 1
    );
  }

  async retry(claim: PolicyClaim): Promise<boolean> {
    const delay = policyRetryDelay(claim.attemptCount);
    return (
      (await this.prisma.$executeRaw`
      UPDATE moderation_policy_evaluations SET
        status = CASE WHEN "attemptCount" >= ${POLICY_MAX_ATTEMPTS}
          THEN 'FAILED'::"ModerationPolicyEvaluationStatus" ELSE status END,
        "errorCode" = 'POLICY_EVALUATION_ERROR',
        "nextAttemptAt" = CASE WHEN "attemptCount" >= ${POLICY_MAX_ATTEMPTS} THEN NULL
          ELSE (statement_timestamp() AT TIME ZONE 'UTC') + ${delay} * interval '1 millisecond' END,
        "leaseToken" = NULL, "leaseExpiresAt" = NULL,
        "updatedAt" = statement_timestamp() AT TIME ZONE 'UTC'
      WHERE id = ${claim.id} AND status = 'PENDING' AND "leaseToken" = ${claim.leaseToken}
        AND "leaseExpiresAt" > statement_timestamp() AT TIME ZONE 'UTC'
    `) === 1
    );
  }

  // Keyset-page ALL analyses by the existing PK, then enqueue successful gaps.
  // This bounds scanned rows even if successful analyses are sparse.
  async reconcile(afterId?: string): Promise<string | undefined> {
    return this.prisma.$transaction(async (tx) => {
      const page = await tx.moderationAnalysis.findMany({
        where: afterId ? { id: { gt: afterId } } : {},
        orderBy: { id: 'asc' },
        take: POLICY_RECONCILE_BATCH_SIZE,
        select: {
          id: true,
          status: true,
          policyEvaluations: {
            where: { policyVersion: MODERATION_POLICY_VERSION_V1 },
            select: { id: true },
            take: 1,
          },
        },
      });
      const missing = page.filter(
        (row) => row.status === 'SUCCEEDED' && !row.policyEvaluations.length,
      );
      if (missing.length)
        await tx.moderationPolicyEvaluation.createMany({
          data: missing.map((row) => ({
            analysisId: row.id,
            policyVersion: MODERATION_POLICY_VERSION_V1,
          })),
          skipDuplicates: true,
        });
      return page.length === POLICY_RECONCILE_BATCH_SIZE
        ? page.at(-1)!.id
        : undefined;
    });
  }
}
