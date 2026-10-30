-- CreateEnum
CREATE TYPE "ModerationPolicyEvaluationStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'UNSUPPORTED');

-- CreateEnum
CREATE TYPE "ModerationPolicyRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "moderation_policy_evaluations" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "policyVersion" VARCHAR(128) NOT NULL,
    "status" "ModerationPolicyEvaluationStatus" NOT NULL DEFAULT 'PENDING',
    "riskLevel" "ModerationPolicyRiskLevel",
    "priorityScore" INTEGER,
    "signals" JSONB,
    "evaluatedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "leaseToken" TEXT,
    "errorCode" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "moderation_policy_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "moderation_policy_evaluations_status_nextAttemptAt_idx" ON "moderation_policy_evaluations"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "moderation_policy_evaluations_leaseExpiresAt_idx" ON "moderation_policy_evaluations"("leaseExpiresAt");

-- CreateIndex
CREATE INDEX "moderation_policy_evaluations_analysisId_idx" ON "moderation_policy_evaluations"("analysisId");

-- CreateIndex
CREATE UNIQUE INDEX "moderation_policy_evaluations_analysisId_policyVersion_key" ON "moderation_policy_evaluations"("analysisId", "policyVersion");

-- AddForeignKey
ALTER TABLE "moderation_policy_evaluations" ADD CONSTRAINT "moderation_policy_evaluations_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "moderation_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma does not model CHECK constraints. Preserve these in future migrations.
ALTER TABLE "moderation_policy_evaluations"
    ADD CONSTRAINT "moderation_policy_evaluations_priority_bounds"
        CHECK ("priorityScore" IS NULL OR "priorityScore" BETWEEN 0 AND 100),
    ADD CONSTRAINT "moderation_policy_evaluations_attempt_count_nonnegative"
        CHECK ("attemptCount" >= 0),
    ADD CONSTRAINT "moderation_policy_evaluations_error_code_format"
        CHECK ("errorCode" IS NULL OR "errorCode" ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    ADD CONSTRAINT "moderation_policy_evaluations_output_status"
        CHECK (
            ("status" = 'SUCCEEDED'
                AND "riskLevel" IS NOT NULL
                AND "priorityScore" IS NOT NULL
                AND "signals" IS NOT NULL
                AND jsonb_typeof("signals") = 'array'
                AND "evaluatedAt" IS NOT NULL
                AND "errorCode" IS NULL)
            OR
            ("status" <> 'SUCCEEDED'
                AND "riskLevel" IS NULL
                AND "priorityScore" IS NULL
                AND "signals" IS NULL
                AND "evaluatedAt" IS NULL)
        );
