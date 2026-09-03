/*
  Warnings:

  - You are about to drop the column `deletedAt` on the `chat_participants` table. All the data in the column will be lost.
  - You are about to drop the column `mutedUntil` on the `chat_participants` table. All the data in the column will be lost.
  - You are about to drop the column `notificationLevel` on the `chat_participants` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `media_uploads` table. All the data in the column will be lost.
  - You are about to drop the column `messageRequestSetting` on the `user` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "InterestEntityType" AS ENUM ('GAME', 'CATEGORY', 'POST_TYPE', 'TAG', 'AUTHOR');

-- AlterTable
ALTER TABLE "chat_participants" DROP COLUMN "deletedAt",
DROP COLUMN "mutedUntil",
DROP COLUMN "notificationLevel",
ADD COLUMN     "mutedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "media_uploads" DROP COLUMN "updatedAt";

-- AlterTable
ALTER TABLE "user" DROP COLUMN "messageRequestSetting";

-- DropEnum
DROP TYPE "ChatNotificationLevel";

-- DropEnum
DROP TYPE "MessageRequestSetting";

-- CreateTable
CREATE TABLE "user_interests" (
    "userId" TEXT NOT NULL,
    "entityType" "InterestEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "signalCount" INTEGER NOT NULL DEFAULT 0,
    "lastSignalAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_interests_pkey" PRIMARY KEY ("userId","entityType","entityId")
);

-- CreateIndex
CREATE INDEX "user_interests_userId_score_idx" ON "user_interests"("userId", "score");

-- AddForeignKey
ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
