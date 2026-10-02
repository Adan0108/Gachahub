-- AlterEnum
ALTER TYPE "MediaPurpose" ADD VALUE 'GAME_BANNER';

-- CreateIndex
CREATE UNIQUE INDEX "games_iconMediaUploadId_key" ON "games"("iconMediaUploadId");

-- CreateIndex
CREATE UNIQUE INDEX "games_bannerMediaUploadId_key" ON "games"("bannerMediaUploadId");
