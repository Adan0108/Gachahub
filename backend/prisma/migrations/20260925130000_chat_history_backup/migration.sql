-- CreateTable
CREATE TABLE "chat_backup_keys" (
    "userId" TEXT NOT NULL,
    "keyCheck" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replaceSecret" BYTEA,
    "challengeNonce" BYTEA,
    "challengeExpiresAt" TIMESTAMP(3),

    CONSTRAINT "chat_backup_keys_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "chat_backup_blobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_backup_blobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_backup_blobs_userId_createdAt_id_idx" ON "chat_backup_blobs"("userId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_backup_blobs_userId_messageId_key" ON "chat_backup_blobs"("userId", "messageId");

-- AddForeignKey
ALTER TABLE "chat_backup_keys" ADD CONSTRAINT "chat_backup_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_backup_blobs" ADD CONSTRAINT "chat_backup_blobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
