-- AlterTable
ALTER TABLE "session" ADD COLUMN     "chatDeviceId" TEXT;

-- CreateIndex
CREATE INDEX "session_chatDeviceId_idx" ON "session"("chatDeviceId");
