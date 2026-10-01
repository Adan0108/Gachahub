-- DropForeignKey
ALTER TABLE "mls_handshakes" DROP CONSTRAINT "mls_handshakes_senderDeviceId_fkey";

-- AlterTable
ALTER TABLE "mls_handshakes" ALTER COLUMN "senderDeviceId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "mls_handshakes" ADD CONSTRAINT "mls_handshakes_senderDeviceId_fkey" FOREIGN KEY ("senderDeviceId") REFERENCES "chat_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
