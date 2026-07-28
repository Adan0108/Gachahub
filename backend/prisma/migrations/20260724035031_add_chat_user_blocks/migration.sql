-- CreateTable
CREATE TABLE "chat_user_blocks" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_user_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_user_blocks_blockedId_idx" ON "chat_user_blocks"("blockedId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_user_blocks_blockerId_blockedId_key" ON "chat_user_blocks"("blockerId", "blockedId");

-- AddForeignKey
ALTER TABLE "chat_user_blocks" ADD CONSTRAINT "chat_user_blocks_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_user_blocks" ADD CONSTRAINT "chat_user_blocks_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
