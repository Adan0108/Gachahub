-- AlterTable
ALTER TABLE "mls_handshakes" DROP COLUMN "addedDeviceIds",
DROP COLUMN "removedDeviceIds",
ADD COLUMN     "addedDevices" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "removedDevices" JSONB NOT NULL DEFAULT '[]';

