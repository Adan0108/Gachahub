-- CreateEnum
CREATE TYPE "MlsKeyPackageKind" AS ENUM ('SINGLE_USE', 'LAST_RESORT');

-- CreateTable
CREATE TABLE "chat_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "signaturePublicKey" BYTEA NOT NULL,
    "ciphersuite" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "chat_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mls_key_packages" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "kind" "MlsKeyPackageKind" NOT NULL DEFAULT 'SINGLE_USE',
    "payload" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "claimedByUserId" TEXT,

    CONSTRAINT "mls_key_packages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_devices_userId_revokedAt_idx" ON "chat_devices"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "mls_key_packages_deviceId_kind_claimedAt_idx" ON "mls_key_packages"("deviceId", "kind", "claimedAt");

-- AddForeignKey
ALTER TABLE "chat_devices" ADD CONSTRAINT "chat_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mls_key_packages" ADD CONSTRAINT "mls_key_packages_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "chat_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
