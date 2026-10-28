-- CreateEnum
CREATE TYPE "GameChannelKind" AS ENUM ('TEXT', 'ANNOUNCEMENT');

-- CreateTable
CREATE TABLE "game_channels" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "topic" TEXT,
    "kind" "GameChannelKind" NOT NULL DEFAULT 'TEXT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "slowmodeSeconds" INTEGER NOT NULL DEFAULT 0,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_channel_messages" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT,
    "content" TEXT NOT NULL,
    "replyToId" TEXT,
    "clientMessageId" TEXT,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "deleteReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_channel_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_channel_reactions" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoteId" TEXT,
    "emoji" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_channel_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_channel_read_states" (
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL,
    "lastReadMessageId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_channel_read_states_pkey" PRIMARY KEY ("userId","channelId")
);

-- CreateIndex
CREATE INDEX "game_channels_gameId_sortOrder_idx" ON "game_channels"("gameId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "game_channels_gameId_slug_key" ON "game_channels"("gameId", "slug");

-- CreateIndex
CREATE INDEX "game_channel_messages_channelId_createdAt_id_idx" ON "game_channel_messages"("channelId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "game_channel_messages_authorId_idx" ON "game_channel_messages"("authorId");

-- CreateIndex
CREATE INDEX "game_channel_messages_replyToId_idx" ON "game_channel_messages"("replyToId");

-- CreateIndex
CREATE UNIQUE INDEX "game_channel_messages_authorId_clientMessageId_key" ON "game_channel_messages"("authorId", "clientMessageId");

-- CreateIndex
CREATE INDEX "game_channel_reactions_messageId_idx" ON "game_channel_reactions"("messageId");

-- CreateIndex
CREATE INDEX "game_channel_reactions_userId_idx" ON "game_channel_reactions"("userId");

-- CreateIndex
CREATE INDEX "game_channel_reactions_emoteId_idx" ON "game_channel_reactions"("emoteId");

-- CreateIndex
CREATE UNIQUE INDEX "game_channel_reactions_messageId_userId_key" ON "game_channel_reactions"("messageId", "userId");

-- CreateIndex
CREATE INDEX "game_channel_read_states_channelId_idx" ON "game_channel_read_states"("channelId");

-- AddForeignKey
ALTER TABLE "game_channels" ADD CONSTRAINT "game_channels_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_channel_messages" ADD CONSTRAINT "game_channel_messages_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "game_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_channel_messages" ADD CONSTRAINT "game_channel_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_channel_messages" ADD CONSTRAINT "game_channel_messages_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_channel_messages" ADD CONSTRAINT "game_channel_messages_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "game_channel_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_channel_reactions" ADD CONSTRAINT "game_channel_reactions_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "game_channel_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_channel_reactions" ADD CONSTRAINT "game_channel_reactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_channel_reactions" ADD CONSTRAINT "game_channel_reactions_emoteId_fkey" FOREIGN KEY ("emoteId") REFERENCES "chat_emotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_channel_read_states" ADD CONSTRAINT "game_channel_read_states_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_channel_read_states" ADD CONSTRAINT "game_channel_read_states_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "game_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Message text is 1 to 2000 characters; the API enforces it too, this keeps a bad write from landing.
ALTER TABLE "game_channel_messages" ADD CONSTRAINT "game_channel_messages_content_length"
  CHECK (char_length("content") BETWEEN 1 AND 2000);

-- A reaction is either an emoji or a custom emote, never both and never neither.
ALTER TABLE "game_channel_reactions" ADD CONSTRAINT "game_channel_reactions_one_kind"
  CHECK (("emoji" IS NULL) <> ("emoteId" IS NULL));
