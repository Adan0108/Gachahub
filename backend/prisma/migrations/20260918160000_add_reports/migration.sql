-- CreateEnum
CREATE TYPE "ReportTargetType" AS ENUM ('POST', 'COMMENT');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('UNMARKED_SPOILERS', 'HARASSMENT', 'COMMERCIAL_SPAM', 'MISINFORMATION', 'NSFW', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'IN_REVIEW', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetType" "ReportTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "reasonCode" "ReportReason" NOT NULL,
    "details" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "assignedModeratorId" TEXT,
    "resolutionNote" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reports_gameId_status_createdAt_idx" ON "reports"("gameId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "reports_gameId_createdAt_idx" ON "reports"("gameId", "createdAt");

-- CreateIndex
CREATE INDEX "reports_status_createdAt_idx" ON "reports"("status", "createdAt");

-- CreateIndex
CREATE INDEX "reports_targetType_targetId_idx" ON "reports"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_assignedModeratorId_fkey" FOREIGN KEY ("assignedModeratorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex (hand-added, keep this when regenerating - Prisma cannot express a
-- unique index scoped to a WHERE clause. Same pattern as
-- 20260805093000_add_global_emote_shortcode_unique's
-- "chat_emotes_global_shortcode_key". Enforces at most one open (PENDING or
-- IN_REVIEW) report per reporter per target, while letting the same reporter
-- file a new report once an earlier one on the same target has closed
-- (RESOLVED/DISMISSED).
CREATE UNIQUE INDEX "reports_open_target_key"
  ON "reports"("reporterId", "targetType", "targetId")
  WHERE "status" IN ('PENDING', 'IN_REVIEW');
