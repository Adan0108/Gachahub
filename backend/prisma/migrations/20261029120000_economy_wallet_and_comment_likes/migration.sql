-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('REPUTATION', 'SHARDS', 'PRISMS');

-- CreateEnum
CREATE TYPE "ReputationRank" AS ENUM ('STARGAZER', 'METEOR', 'COMET', 'NOVA', 'SUPERNOVA', 'GALAXY');

-- CreateEnum
CREATE TYPE "LedgerReason" AS ENUM ('DAILY_CHECKIN', 'LIKE_RECEIVED', 'COMMENT_RECEIVED', 'LIKE_MILESTONE', 'COMMENT_WRITTEN', 'REVOKED', 'RESTORED', 'ADMIN_ADJUST');

-- CreateEnum
CREATE TYPE "EconomySource" AS ENUM ('POST', 'COMMENT');

-- CreateEnum
CREATE TYPE "InteractionKind" AS ENUM ('LIKE', 'COMMENT');

-- CreateEnum
CREATE TYPE "RevokeCause" AS ENUM ('CONTENT', 'ACTOR');

-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "likeCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "comment_likes" (
    "commentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_likes_pkey" PRIMARY KEY ("commentId","userId")
);

-- CreateTable
CREATE TABLE "user_wallets" (
    "userId" TEXT NOT NULL,
    "reputation" INTEGER NOT NULL DEFAULT 0,
    "shards" INTEGER NOT NULL DEFAULT 0,
    "prisms" INTEGER NOT NULL DEFAULT 0,
    "reputation90d" INTEGER NOT NULL DEFAULT 0,
    "rank" "ReputationRank" NOT NULL DEFAULT 'STARGAZER',
    "rankUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_wallets_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" "LedgerReason" NOT NULL,
    "sourceType" "EconomySource",
    "sourceId" TEXT,
    "actorId" TEXT,
    "awardId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedCause" "RevokeCause",
    "revokedAmount" INTEGER,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_earnings" (
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "baseShards" INTEGER NOT NULL DEFAULT 0,
    "creditedShards" INTEGER NOT NULL DEFAULT 0,
    "likesCounted" INTEGER NOT NULL DEFAULT 0,
    "commentsCounted" INTEGER NOT NULL DEFAULT 0,
    "repFromLikes" INTEGER NOT NULL DEFAULT 0,
    "repFromComments" INTEGER NOT NULL DEFAULT 0,
    "commentsWritten" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "daily_earnings_pkey" PRIMARY KEY ("userId","day")
);

-- CreateTable
CREATE TABLE "daily_giver_reputation" (
    "ownerId" TEXT NOT NULL,
    "giverId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "reputation" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "daily_giver_reputation_pkey" PRIMARY KEY ("ownerId","giverId","day")
);

-- CreateTable
CREATE TABLE "counted_interactions" (
    "kind" "InteractionKind" NOT NULL,
    "targetType" "EconomySource" NOT NULL,
    "targetId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "counted_interactions_pkey" PRIMARY KEY ("kind","targetType","targetId","actorId")
);

-- CreateIndex
CREATE INDEX "comment_likes_userId_createdAt_idx" ON "comment_likes"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "user_wallets_reputation90d_idx" ON "user_wallets"("reputation90d");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_idempotencyKey_key" ON "ledger_entries"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ledger_entries_userId_currency_createdAt_idx" ON "ledger_entries"("userId", "currency", "createdAt");

-- CreateIndex
CREATE INDEX "ledger_entries_actorId_idx" ON "ledger_entries"("actorId");

-- CreateIndex
CREATE INDEX "ledger_entries_sourceType_sourceId_idx" ON "ledger_entries"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "counted_interactions_kind_targetType_targetId_idx" ON "counted_interactions"("kind", "targetType", "targetId");

-- AddForeignKey
ALTER TABLE "comment_likes" ADD CONSTRAINT "comment_likes_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_likes" ADD CONSTRAINT "comment_likes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_wallets" ADD CONSTRAINT "user_wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_earnings" ADD CONSTRAINT "daily_earnings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'WALLET_ADJUSTED';
