-- Images in community chat
ALTER TYPE "MediaPurpose" ADD VALUE 'COMMUNITY';

-- A message made of pictures alone has no text; the API still asks for text or a picture.
ALTER TABLE "game_channel_messages" DROP CONSTRAINT "game_channel_messages_content_length";
ALTER TABLE "game_channel_messages" ADD CONSTRAINT "game_channel_messages_content_length"
  CHECK (char_length("content") BETWEEN 0 AND 2000);

CREATE TABLE "game_channel_message_media" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "mediaUploadId" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER,
    "format" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_channel_message_media_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "game_channel_message_media_mediaUploadId_key" ON "game_channel_message_media"("mediaUploadId");

CREATE INDEX "game_channel_message_media_messageId_sortOrder_idx" ON "game_channel_message_media"("messageId", "sortOrder");

ALTER TABLE "game_channel_message_media" ADD CONSTRAINT "game_channel_message_media_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "game_channel_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "game_channel_message_media" ADD CONSTRAINT "game_channel_message_media_mediaUploadId_fkey" FOREIGN KEY ("mediaUploadId") REFERENCES "media_uploads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
