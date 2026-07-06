-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED');

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'USER',
ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "game_moderators" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_moderators_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "game_moderators_gameId_idx" ON "game_moderators"("gameId");

-- CreateIndex
CREATE INDEX "game_moderators_userId_idx" ON "game_moderators"("userId");

-- CreateIndex
CREATE INDEX "game_moderators_assignedBy_idx" ON "game_moderators"("assignedBy");

-- CreateIndex
CREATE UNIQUE INDEX "game_moderators_gameId_userId_key" ON "game_moderators"("gameId", "userId");

-- AddForeignKey
ALTER TABLE "game_moderators" ADD CONSTRAINT "game_moderators_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_moderators" ADD CONSTRAINT "game_moderators_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_moderators" ADD CONSTRAINT "game_moderators_assignedBy_fkey" FOREIGN KEY ("assignedBy") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
