-- CreateTable
CREATE TABLE "mls_commit_faults" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL,
    "senderDeviceId" TEXT,
    "reporterDeviceId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mls_commit_faults_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mls_commit_faults_conversationId_epoch_idx" ON "mls_commit_faults"("conversationId", "epoch");

-- CreateIndex
CREATE UNIQUE INDEX "mls_commit_faults_conversationId_epoch_reporterDeviceId_key" ON "mls_commit_faults"("conversationId", "epoch", "reporterDeviceId");

-- AddForeignKey
ALTER TABLE "mls_commit_faults" ADD CONSTRAINT "mls_commit_faults_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

