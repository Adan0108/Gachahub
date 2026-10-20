-- A group photo is now an uploaded image instead of a pasted URL
ALTER TYPE "MediaPurpose" ADD VALUE 'GROUP_PHOTO';

ALTER TABLE "chat_conversations" ADD COLUMN "photoMediaUploadId" TEXT;

CREATE UNIQUE INDEX "chat_conversations_photoMediaUploadId_key" ON "chat_conversations"("photoMediaUploadId");

ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_photoMediaUploadId_fkey" FOREIGN KEY ("photoMediaUploadId") REFERENCES "media_uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
