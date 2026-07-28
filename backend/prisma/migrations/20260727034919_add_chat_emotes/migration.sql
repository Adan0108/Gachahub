/*
  Warnings:

  - You are about to drop the column `type` on the `chat_message_reactions` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "GameMemberRole" AS ENUM ('MEMBER', 'MODERATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "ChatEmoteScope" AS ENUM ('GLOBAL', 'GAME');

-- AlterEnum
ALTER TYPE "ChatMessageContentType" ADD VALUE 'EMOTE';

-- AlterTable
ALTER TABLE "chat_message_reactions" DROP COLUMN "type",
ADD COLUMN     "emoteId" TEXT;

-- DropEnum
DROP TYPE "ChatMessageReactionType";

-- CreateTable
CREATE TABLE "game_members" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "GameMemberRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_emotes" (
    "id" TEXT NOT NULL,
    "scope" "ChatEmoteScope" NOT NULL,
    "gameId" TEXT,
    "shortcode" TEXT NOT NULL,
    "unicode" TEXT,
    "imageUrl" TEXT,
    "animationUrl" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "chat_emotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "game_members_userId_idx" ON "game_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "game_members_gameId_userId_key" ON "game_members"("gameId", "userId");

-- CreateIndex
CREATE INDEX "chat_emotes_gameId_idx" ON "chat_emotes"("gameId");

-- CreateIndex
CREATE INDEX "chat_emotes_createdById_idx" ON "chat_emotes"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "chat_emotes_scope_gameId_shortcode_key" ON "chat_emotes"("scope", "gameId", "shortcode");

-- CreateIndex
CREATE INDEX "chat_message_reactions_emoteId_idx" ON "chat_message_reactions"("emoteId");

-- AddForeignKey
ALTER TABLE "game_members" ADD CONSTRAINT "game_members_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_members" ADD CONSTRAINT "game_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_message_reactions" ADD CONSTRAINT "chat_message_reactions_emoteId_fkey" FOREIGN KEY ("emoteId") REFERENCES "chat_emotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_emotes" ADD CONSTRAINT "chat_emotes_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_emotes" ADD CONSTRAINT "chat_emotes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
