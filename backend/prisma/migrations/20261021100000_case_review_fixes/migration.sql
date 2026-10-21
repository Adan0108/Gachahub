-- Ordered after 20261021000000_moderation_analysis_requests on the AI branch.
-- Independent of that table: no AI schema or behavior is required here.
ALTER TABLE "reports" DROP CONSTRAINT "reports_reporterId_fkey";
ALTER TABLE "reports" ALTER COLUMN "reporterId" DROP NOT NULL;
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporterId_fkey"
  FOREIGN KEY ("reporterId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "moderation_cases" ADD COLUMN "lastReportedAt" TIMESTAMP(3);
UPDATE "moderation_cases" c SET "lastReportedAt" = COALESCE(
  (SELECT MAX(r."createdAt") FROM "reports" r WHERE r."caseId" = c.id), c."createdAt"
);
ALTER TABLE "moderation_cases" ALTER COLUMN "lastReportedAt" SET NOT NULL,
  ALTER COLUMN "lastReportedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "moderation_cases_lastReportedAt_id_idx" ON "moderation_cases"("lastReportedAt", "id");
CREATE INDEX "moderation_cases_gameId_status_lastReportedAt_id_idx"
  ON "moderation_cases"("gameId", "status", "lastReportedAt", "id");

ALTER TYPE "AuditAction" ADD VALUE 'CASE_ASSIGNED';
