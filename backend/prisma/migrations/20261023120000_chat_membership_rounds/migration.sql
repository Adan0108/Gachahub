-- CreateTable
CREATE TABLE "chat_membership_rounds" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_membership_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_membership_rounds_conversationId_userId_createdAt_idx" ON "chat_membership_rounds"("conversationId", "userId", "createdAt");

-- AddForeignKey
ALTER TABLE "chat_membership_rounds" ADD CONSTRAINT "chat_membership_rounds_conversationId_userId_fkey" FOREIGN KEY ("conversationId", "userId") REFERENCES "chat_participants"("conversationId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Each participant's latest round, the only one the old columns kept.
INSERT INTO "chat_membership_rounds" ("id", "conversationId", "userId", "invitedAt", "joinedAt", "createdAt")
SELECT 'round_' || "id", "conversationId", "userId", "invitedAt", "joinedAt", COALESCE("invitedAt", "joinedAt")
FROM "chat_participants"
WHERE "invitedAt" IS NOT NULL OR "joinedAt" IS NOT NULL;

-- AlterTable
ALTER TABLE "chat_participants" DROP COLUMN "invitedAt",
DROP COLUMN "joinedAt";
