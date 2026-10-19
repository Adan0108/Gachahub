-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'CHAT_USER_TIMED_OUT';
ALTER TYPE "AuditAction" ADD VALUE 'CHAT_TIMEOUT_LIFTED';
ALTER TYPE "AuditAction" ADD VALUE 'CHAT_CHANNEL_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'CHAT_CHANNEL_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'CHAT_MESSAGE_REMOVED';

-- AlterEnum
ALTER TYPE "AuditTargetType" ADD VALUE 'CHANNEL';
ALTER TYPE "AuditTargetType" ADD VALUE 'CHAT_MESSAGE';

-- CreateTable
CREATE TABLE "game_chat_timeouts" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_chat_timeouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "game_chat_timeouts_until_idx" ON "game_chat_timeouts"("until");

-- CreateIndex
CREATE UNIQUE INDEX "game_chat_timeouts_gameId_userId_key" ON "game_chat_timeouts"("gameId", "userId");

-- AddForeignKey
ALTER TABLE "game_chat_timeouts" ADD CONSTRAINT "game_chat_timeouts_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_chat_timeouts" ADD CONSTRAINT "game_chat_timeouts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_chat_timeouts" ADD CONSTRAINT "game_chat_timeouts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
