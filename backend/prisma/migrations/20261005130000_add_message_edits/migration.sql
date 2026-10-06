-- AlterEnum
ALTER TYPE "ChatMessageContentType" ADD VALUE 'EDIT';

-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "editsMessageId" TEXT;

-- CreateIndex
CREATE INDEX "chat_messages_editsMessageId_idx" ON "chat_messages"("editsMessageId");

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_editsMessageId_fkey" FOREIGN KEY ("editsMessageId") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
