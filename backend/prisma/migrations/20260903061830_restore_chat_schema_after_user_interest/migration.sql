/*
  Warnings:

  - You are about to drop the column `mutedAt` on the `chat_participants` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `media_uploads` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "MessageRequestSetting" AS ENUM ('EVERYONE', 'FOLLOWERS', 'NO_ONE');

-- CreateEnum
CREATE TYPE "ChatNotificationLevel" AS ENUM ('ALL', 'NOTHING');

-- AlterTable
ALTER TABLE "chat_participants" DROP COLUMN "mutedAt",
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "mutedUntil" TIMESTAMP(3),
ADD COLUMN     "notificationLevel" "ChatNotificationLevel" NOT NULL DEFAULT 'ALL';

-- AlterTable
ALTER TABLE "media_uploads" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "messageRequestSetting" "MessageRequestSetting" NOT NULL DEFAULT 'EVERYONE';
