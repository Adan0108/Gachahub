-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_iconMediaUploadId_fkey" FOREIGN KEY ("iconMediaUploadId") REFERENCES "media_uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_bannerMediaUploadId_fkey" FOREIGN KEY ("bannerMediaUploadId") REFERENCES "media_uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
