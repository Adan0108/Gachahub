/*
  Warnings:

  - A unique constraint covering the columns `[mediaUploadId]` on the table `post_media` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `assetId` to the `post_media` table without a default value. This is not possible if the table is not empty.
  - Added the required column `mediaUploadId` to the `post_media` table without a default value. This is not possible if the table is not empty.
  - Made the column `publicId` on table `post_media` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "MediaPurpose" AS ENUM ('POST', 'COMMENT', 'CHAT', 'AVATAR', 'BANNER');

-- CreateEnum
CREATE TYPE "MediaResourceType" AS ENUM ('IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "MediaUploadStatus" AS ENUM ('INITIATED', 'UPLOADED', 'ATTACHED', 'DELETED', 'FAILED');

-- AlterTable
ALTER TABLE "post_media" ADD COLUMN     "assetId" TEXT NOT NULL,
ADD COLUMN     "bytes" INTEGER,
ADD COLUMN     "duration" DOUBLE PRECISION,
ADD COLUMN     "format" TEXT,
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "mediaUploadId" TEXT NOT NULL,
ADD COLUMN     "width" INTEGER,
ALTER COLUMN "publicId" SET NOT NULL;

-- CreateTable
CREATE TABLE "media_uploads" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "MediaPurpose" NOT NULL,
    "resourceType" "MediaResourceType" NOT NULL,
    "status" "MediaUploadStatus" NOT NULL DEFAULT 'INITIATED',
    "assetId" TEXT,
    "publicId" TEXT NOT NULL,
    "secureUrl" TEXT,
    "version" INTEGER,
    "format" TEXT,
    "bytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "duration" DOUBLE PRECISION,
    "responseSignature" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "attachedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "media_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_uploads_assetId_key" ON "media_uploads"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "media_uploads_publicId_key" ON "media_uploads"("publicId");

-- CreateIndex
CREATE INDEX "media_uploads_userId_status_createdAt_idx" ON "media_uploads"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "media_uploads_status_createdAt_idx" ON "media_uploads"("status", "createdAt");

-- CreateIndex
CREATE INDEX "media_uploads_purpose_status_idx" ON "media_uploads"("purpose", "status");

-- CreateIndex
CREATE UNIQUE INDEX "post_media_mediaUploadId_key" ON "post_media"("mediaUploadId");

-- AddForeignKey
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_mediaUploadId_fkey" FOREIGN KEY ("mediaUploadId") REFERENCES "media_uploads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_uploads" ADD CONSTRAINT "media_uploads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
