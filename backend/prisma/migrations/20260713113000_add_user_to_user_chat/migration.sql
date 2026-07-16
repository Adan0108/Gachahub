-- CreateEnum
CREATE TYPE "ChatConversationType" AS ENUM ('DIRECT', 'GROUP', 'GAME_ADMIN', 'FORUM_SUPPORT');

-- CreateEnum
CREATE TYPE "ChatConversationStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'LOCKED');

-- CreateEnum
CREATE TYPE "ChatParticipantRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "ChatParticipantState" AS ENUM ('ACTIVE', 'PENDING', 'DECLINED', 'BLOCKED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ChatMessageContentType" AS ENUM ('TEXT', 'IMAGE', 'FILE', 'AUDIO', 'VIDEO', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ChatMessageStatus" AS ENUM ('SENT', 'DELETED');

-- CreateTable
CREATE TABLE "chat_conversations" (
    "id" TEXT NOT NULL,
    "type" "ChatConversationType" NOT NULL DEFAULT 'DIRECT',
    "status" "ChatConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "title" TEXT,
    "photoUrl" TEXT,
    "createdBy" TEXT,
    "lastMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_participants" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ChatParticipantRole" NOT NULL DEFAULT 'MEMBER',
    "state" "ChatParticipantState" NOT NULL DEFAULT 'ACTIVE',
    "lastReadAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "mutedAt" TIMESTAMP(3),
    "blockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_direct_pairs" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userIdA" TEXT NOT NULL,
    "userIdB" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_direct_pairs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "clientMessageId" TEXT,
    "ciphertext" TEXT NOT NULL,
    "encryptionMeta" JSONB,
    "contentType" "ChatMessageContentType" NOT NULL DEFAULT 'TEXT',
    "status" "ChatMessageStatus" NOT NULL DEFAULT 'SENT',
    "replyToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_message_receipts" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_message_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_conversations_type_idx" ON "chat_conversations"("type");

-- CreateIndex
CREATE INDEX "chat_conversations_status_idx" ON "chat_conversations"("status");

-- CreateIndex
CREATE INDEX "chat_conversations_updatedAt_idx" ON "chat_conversations"("updatedAt");

-- CreateIndex
CREATE INDEX "chat_conversations_createdBy_idx" ON "chat_conversations"("createdBy");

-- CreateIndex
CREATE INDEX "chat_participants_userId_state_idx" ON "chat_participants"("userId", "state");

-- CreateIndex
CREATE INDEX "chat_participants_conversationId_state_idx" ON "chat_participants"("conversationId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "chat_participants_conversationId_userId_key" ON "chat_participants"("conversationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_direct_pairs_conversationId_key" ON "chat_direct_pairs"("conversationId");

-- CreateIndex
CREATE INDEX "chat_direct_pairs_userIdA_idx" ON "chat_direct_pairs"("userIdA");

-- CreateIndex
CREATE INDEX "chat_direct_pairs_userIdB_idx" ON "chat_direct_pairs"("userIdB");

-- CreateIndex
CREATE UNIQUE INDEX "chat_direct_pairs_userIdA_userIdB_key" ON "chat_direct_pairs"("userIdA", "userIdB");

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_senderId_clientMessageId_key" ON "chat_messages"("senderId", "clientMessageId");

-- CreateIndex
CREATE INDEX "chat_messages_conversationId_createdAt_idx" ON "chat_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "chat_messages_conversationId_id_idx" ON "chat_messages"("conversationId", "id");

-- CreateIndex
CREATE INDEX "chat_messages_senderId_idx" ON "chat_messages"("senderId");

-- CreateIndex
CREATE INDEX "chat_messages_replyToId_idx" ON "chat_messages"("replyToId");

-- CreateIndex
CREATE INDEX "chat_message_receipts_userId_deliveredAt_idx" ON "chat_message_receipts"("userId", "deliveredAt");

-- CreateIndex
CREATE INDEX "chat_message_receipts_userId_readAt_idx" ON "chat_message_receipts"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "chat_message_receipts_messageId_userId_key" ON "chat_message_receipts"("messageId", "userId");

-- AddForeignKey
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_direct_pairs" ADD CONSTRAINT "chat_direct_pairs_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_direct_pairs" ADD CONSTRAINT "chat_direct_pairs_userIdA_fkey" FOREIGN KEY ("userIdA") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_direct_pairs" ADD CONSTRAINT "chat_direct_pairs_userIdB_fkey" FOREIGN KEY ("userIdB") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_message_receipts" ADD CONSTRAINT "chat_message_receipts_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_message_receipts" ADD CONSTRAINT "chat_message_receipts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
