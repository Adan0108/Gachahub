-- AlterEnum
ALTER TYPE "MediaPurpose" ADD VALUE 'GAME_ICON';

-- AlterTable
ALTER TABLE "games" ADD COLUMN "iconMediaUploadId" TEXT;
ALTER TABLE "games" ADD COLUMN "bannerMediaUploadId" TEXT;

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'GAME_ARCHIVED';
ALTER TYPE "AuditAction" ADD VALUE 'GAME_RESTORED';
ALTER TYPE "AuditAction" ADD VALUE 'GAME_FLAGGED';

-- AlterEnum
ALTER TYPE "AuditTargetType" ADD VALUE 'GAME';
