CREATE TYPE "ModerationAnalysisStatus" AS ENUM ('PENDING');

CREATE TABLE "moderation_analyses" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "sourceReportId" TEXT,
    "targetType" "ReportTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "inputSchemaVersion" INTEGER NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "classifierProfile" TEXT NOT NULL,
    "status" "ModerationAnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "moderation_analyses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "moderation_analyses_caseId_snapshotHash_classifierProfile_key"
    ON "moderation_analyses"("caseId", "snapshotHash", "classifierProfile");
CREATE UNIQUE INDEX "moderation_analyses_caseId_generation_key"
    ON "moderation_analyses"("caseId", "generation");
CREATE INDEX "moderation_analyses_sourceReportId_idx" ON "moderation_analyses"("sourceReportId");

ALTER TABLE "moderation_analyses" ADD CONSTRAINT "moderation_analyses_caseId_fkey"
    FOREIGN KEY ("caseId") REFERENCES "moderation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "moderation_analyses" ADD CONSTRAINT "moderation_analyses_sourceReportId_fkey"
    FOREIGN KEY ("sourceReportId") REFERENCES "reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
