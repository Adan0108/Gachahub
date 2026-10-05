-- AlterTable
ALTER TABLE "user" ADD COLUMN     "avatarMediaUploadId" TEXT,
ADD COLUMN     "bannerPresetId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "user_avatarMediaUploadId_key" ON "user"("avatarMediaUploadId");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_avatarMediaUploadId_fkey" FOREIGN KEY ("avatarMediaUploadId") REFERENCES "media_uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
