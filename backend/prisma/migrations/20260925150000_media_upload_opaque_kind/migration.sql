-- CreateEnum
CREATE TYPE "MediaOpaqueKind" AS ENUM ('BLOB', 'THUMB');

-- AlterTable
ALTER TABLE "media_uploads" ADD COLUMN "opaqueKind" "MediaOpaqueKind";
