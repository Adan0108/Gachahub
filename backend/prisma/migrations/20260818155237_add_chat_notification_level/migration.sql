-- CreateEnum
CREATE TYPE "ChatNotificationLevel" AS ENUM ('ALL', 'NOTHING');

-- AlterTable
ALTER TABLE "chat_participants" ADD COLUMN "notificationLevel" "ChatNotificationLevel" NOT NULL DEFAULT 'ALL';
ALTER TABLE "chat_participants" ADD COLUMN "mutedUntil" TIMESTAMP(3);

UPDATE "chat_participants" SET "notificationLevel" = 'NOTHING' WHERE "mutedAt" IS NOT NULL;

ALTER TABLE "chat_participants" DROP COLUMN "mutedAt";
