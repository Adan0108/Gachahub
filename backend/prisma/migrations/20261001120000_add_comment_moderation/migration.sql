-- CreateEnum
CREATE TYPE "CommentStatus" AS ENUM ('PUBLISHED', 'HIDDEN');

-- AlterTable
ALTER TABLE "comments" ADD COLUMN "status" "CommentStatus" NOT NULL DEFAULT 'PUBLISHED';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'COMMENT_HIDDEN';
ALTER TYPE "AuditAction" ADD VALUE 'COMMENT_RESTORED';

-- AlterEnum
ALTER TYPE "AuditTargetType" ADD VALUE 'COMMENT';
