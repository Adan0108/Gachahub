-- AlterTable
ALTER TABLE "chat_conversations" ADD COLUMN     "mlsEpoch" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "mls_handshakes" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL,
    "senderDeviceId" TEXT NOT NULL,
    "payload" BYTEA NOT NULL,
    "payloadSha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mls_handshakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mls_welcomes" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "recipientDeviceId" TEXT NOT NULL,
    "payload" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "mls_welcomes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mls_handshakes_conversationId_epoch_key" ON "mls_handshakes"("conversationId", "epoch");

-- CreateIndex
CREATE INDEX "mls_welcomes_recipientDeviceId_consumedAt_idx" ON "mls_welcomes"("recipientDeviceId", "consumedAt");

-- AddForeignKey
ALTER TABLE "mls_handshakes" ADD CONSTRAINT "mls_handshakes_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mls_handshakes" ADD CONSTRAINT "mls_handshakes_senderDeviceId_fkey" FOREIGN KEY ("senderDeviceId") REFERENCES "chat_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mls_welcomes" ADD CONSTRAINT "mls_welcomes_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mls_welcomes" ADD CONSTRAINT "mls_welcomes_recipientDeviceId_fkey" FOREIGN KEY ("recipientDeviceId") REFERENCES "chat_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
