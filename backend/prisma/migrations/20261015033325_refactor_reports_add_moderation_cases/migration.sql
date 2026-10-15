/*
  Warnings:

  - You are about to drop the column `assignedModeratorId` on the `reports` table. All the data in the column will be lost.
  - You are about to drop the column `gameId` on the `reports` table. All the data in the column will be lost.
  - You are about to drop the column `resolutionNote` on the `reports` table. All the data in the column will be lost.
  - You are about to drop the column `resolvedAt` on the `reports` table. All the data in the column will be lost.
  - You are about to drop the column `resolvedById` on the `reports` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `reports` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `reports` table. All the data in the column will be lost.
  - Added the required column `caseId` to the `reports` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ModerationCaseStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ModerationRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReportReason" ADD VALUE 'HATE';
ALTER TYPE "ReportReason" ADD VALUE 'VIOLENCE';
ALTER TYPE "ReportReason" ADD VALUE 'SCAM';
ALTER TYPE "ReportReason" ADD VALUE 'IMPERSONATION';

-- DropForeignKey
ALTER TABLE "reports" DROP CONSTRAINT "reports_assignedModeratorId_fkey";

-- DropForeignKey
ALTER TABLE "reports" DROP CONSTRAINT "reports_gameId_fkey";

-- DropForeignKey
ALTER TABLE "reports" DROP CONSTRAINT "reports_resolvedById_fkey";

-- DropIndex
DROP INDEX "reports_gameId_createdAt_idx";

-- DropIndex
DROP INDEX "reports_gameId_status_createdAt_idx";

-- DropIndex
DROP INDEX "reports_status_createdAt_idx";

-- AlterTable
ALTER TABLE "reports" DROP COLUMN "assignedModeratorId",
DROP COLUMN "gameId",
DROP COLUMN "resolutionNote",
DROP COLUMN "resolvedAt",
DROP COLUMN "resolvedById",
DROP COLUMN "status",
DROP COLUMN "updatedAt",
ADD COLUMN     "caseId" TEXT NOT NULL,
ADD COLUMN     "targetSnapshot" JSONB;

-- DropEnum
DROP TYPE "ReportStatus";

-- CreateTable
CREATE TABLE "moderation_cases" (
    "id" TEXT NOT NULL,
    "targetType" "ReportTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "gameId" TEXT,
    "status" "ModerationCaseStatus" NOT NULL DEFAULT 'OPEN',
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "uniqueReporterCount" INTEGER NOT NULL DEFAULT 0,
    "currentRiskScore" DOUBLE PRECISION,
    "currentRiskLevel" "ModerationRiskLevel",
    "assignedModeratorId" TEXT,
    "resolutionNote" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "moderation_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "moderation_cases_gameId_status_createdAt_idx" ON "moderation_cases"("gameId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "moderation_cases_gameId_createdAt_idx" ON "moderation_cases"("gameId", "createdAt");

-- CreateIndex
CREATE INDEX "moderation_cases_status_currentRiskLevel_createdAt_idx" ON "moderation_cases"("status", "currentRiskLevel", "createdAt");

-- CreateIndex
CREATE INDEX "moderation_cases_targetType_targetId_idx" ON "moderation_cases"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "moderation_cases_assignedModeratorId_idx" ON "moderation_cases"("assignedModeratorId");

-- CreateIndex
CREATE INDEX "reports_reporterId_createdAt_idx" ON "reports"("reporterId", "createdAt");

-- CreateIndex
CREATE INDEX "reports_caseId_createdAt_idx" ON "reports"("caseId", "createdAt");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "moderation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_assignedModeratorId_fkey" FOREIGN KEY ("assignedModeratorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
