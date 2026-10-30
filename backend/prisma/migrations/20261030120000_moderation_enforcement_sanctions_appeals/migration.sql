-- CreateEnum
CREATE TYPE "EnforcementScope" AS ENUM ('COMMUNITY', 'PLATFORM');

-- CreateEnum
CREATE TYPE "ViolationSeverity" AS ENUM ('MINOR', 'MODERATE', 'SEVERE', 'CRITICAL');

-- CreateEnum
CREATE TYPE "SanctionType" AS ENUM ('WARNING', 'COMMUNITY_RESTRICTION', 'COMMUNITY_BAN', 'PLATFORM_SUSPENSION');

-- CreateEnum
CREATE TYPE "SanctionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AppealStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'MODERATION_NOTICE';

-- AlterEnum
ALTER TYPE "NotificationEntityType" ADD VALUE 'MODERATION_ACTION';

-- CreateTable
CREATE TABLE "content_enforcements" (
    "id" TEXT NOT NULL,
    "targetType" "ReportTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "actorId" TEXT,
    "scope" "EnforcementScope" NOT NULL,
    "gameId" TEXT,
    "caseId" TEXT,
    "reason" VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "content_enforcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_violations" (
    "incidentKey" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "actorId" TEXT,
    "scope" "EnforcementScope" NOT NULL,
    "gameId" TEXT,
    "category" "ReportReason" NOT NULL,
    "severity" "ViolationSeverity" NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),

    CONSTRAINT "moderation_violations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_sanctions" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" "SanctionType" NOT NULL,
    "scope" "EnforcementScope" NOT NULL,
    "gameId" TEXT,
    "caseId" TEXT,
    "violationId" TEXT,
    "enforcementId" TEXT,
    "reason" VARCHAR(1000) NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "status" "SanctionStatus" NOT NULL DEFAULT 'ACTIVE',
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,

    CONSTRAINT "moderation_sanctions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_appeals" (
    "id" TEXT NOT NULL,
    "sanctionId" TEXT NOT NULL,
    "statement" VARCHAR(2000) NOT NULL,
    "status" "AppealStatus" NOT NULL DEFAULT 'PENDING',
    "reviewerId" TEXT,
    "decisionReason" VARCHAR(1000),
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_appeals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_decision_audits" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" VARCHAR(64) NOT NULL,
    "entityId" TEXT NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "previousState" JSONB NOT NULL,
    "resultingState" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_decision_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "content_enforcements_targetType_targetId_revokedAt_idx" ON "content_enforcements"("targetType", "targetId", "revokedAt");

-- CreateIndex
CREATE INDEX "content_enforcements_subjectId_createdAt_idx" ON "content_enforcements"("subjectId", "createdAt");

-- CreateIndex
CREATE INDEX "content_enforcements_caseId_createdAt_idx" ON "content_enforcements"("caseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "moderation_violations_incidentKey_key" ON "moderation_violations"("incidentKey");

-- CreateIndex
CREATE UNIQUE INDEX "moderation_violations_caseId_key" ON "moderation_violations"("caseId");

-- CreateIndex
CREATE INDEX "moderation_violations_subjectId_scope_gameId_reversedAt_cre_idx" ON "moderation_violations"("subjectId", "scope", "gameId", "reversedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "moderation_sanctions_requestKey_key" ON "moderation_sanctions"("requestKey");

-- CreateIndex
CREATE INDEX "moderation_sanctions_subjectId_scope_gameId_status_expiresA_idx" ON "moderation_sanctions"("subjectId", "scope", "gameId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "moderation_sanctions_status_expiresAt_idx" ON "moderation_sanctions"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "moderation_sanctions_subjectId_createdAt_id_idx" ON "moderation_sanctions"("subjectId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "moderation_appeals_sanctionId_key" ON "moderation_appeals"("sanctionId");

-- CreateIndex
CREATE INDEX "moderation_appeals_status_createdAt_id_idx" ON "moderation_appeals"("status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "moderation_decision_audits_entityId_createdAt_idx" ON "moderation_decision_audits"("entityId", "createdAt");

-- AddForeignKey
ALTER TABLE "content_enforcements" ADD CONSTRAINT "content_enforcements_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_enforcements" ADD CONSTRAINT "content_enforcements_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_enforcements" ADD CONSTRAINT "content_enforcements_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_enforcements" ADD CONSTRAINT "content_enforcements_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "moderation_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_violations" ADD CONSTRAINT "moderation_violations_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_violations" ADD CONSTRAINT "moderation_violations_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_violations" ADD CONSTRAINT "moderation_violations_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "moderation_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_violations" ADD CONSTRAINT "moderation_violations_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_sanctions" ADD CONSTRAINT "moderation_sanctions_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_sanctions" ADD CONSTRAINT "moderation_sanctions_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_sanctions" ADD CONSTRAINT "moderation_sanctions_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_sanctions" ADD CONSTRAINT "moderation_sanctions_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "moderation_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_sanctions" ADD CONSTRAINT "moderation_sanctions_violationId_fkey" FOREIGN KEY ("violationId") REFERENCES "moderation_violations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_sanctions" ADD CONSTRAINT "moderation_sanctions_enforcementId_fkey" FOREIGN KEY ("enforcementId") REFERENCES "content_enforcements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_sanctionId_fkey" FOREIGN KEY ("sanctionId") REFERENCES "moderation_sanctions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_decision_audits" ADD CONSTRAINT "moderation_decision_audits_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

