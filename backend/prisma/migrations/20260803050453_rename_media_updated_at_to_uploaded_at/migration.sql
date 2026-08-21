/*
  Warnings:

  - You are about to drop the column `updatedAt` on the `media_uploads` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "media_uploads" DROP COLUMN "updatedAt",
ADD COLUMN     "uploadedAt" TIMESTAMP(3);
