-- CreateTable
CREATE TABLE "mls_group_infos" (
    "conversationId" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL,
    "payload" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mls_group_infos_pkey" PRIMARY KEY ("conversationId")
);

-- AddForeignKey
ALTER TABLE "mls_group_infos" ADD CONSTRAINT "mls_group_infos_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
