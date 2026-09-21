-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ChatParticipantState" ADD VALUE 'JOINING';
ALTER TYPE "ChatParticipantState" ADD VALUE 'LEAVING';

-- AlterTable
ALTER TABLE "mls_handshakes" ADD COLUMN     "addedDevices" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "membershipDeclared" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "removedDevices" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "mls_group_members" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedEpoch" INTEGER NOT NULL,
    "removedEpoch" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mls_group_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mls_group_members_conversationId_removedEpoch_idx" ON "mls_group_members"("conversationId", "removedEpoch");

-- CreateIndex
CREATE INDEX "mls_group_members_conversationId_userId_idx" ON "mls_group_members"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "mls_group_members_deviceId_idx" ON "mls_group_members"("deviceId");

-- AddForeignKey
ALTER TABLE "mls_group_members" ADD CONSTRAINT "mls_group_members_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- At most one live leaf per device per conversation. Prisma cannot express a WHERE-scoped unique
-- index, so it is hand-written here (same pattern as chat_emotes_global_shortcode_key).
CREATE UNIQUE INDEX "mls_group_members_active_device_key" ON "mls_group_members"("conversationId", "deviceId") WHERE "removedEpoch" IS NULL;

-- A leaf is removed by a later Commit than the one that added it. Also hand-written; Prisma has no CHECK support.
ALTER TABLE "mls_group_members" ADD CONSTRAINT "mls_group_members_epochs_check" CHECK ("addedEpoch" >= 0 AND ("removedEpoch" IS NULL OR "removedEpoch" > "addedEpoch"));
