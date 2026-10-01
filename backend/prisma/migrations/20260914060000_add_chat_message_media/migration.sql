-- CreateTable
CREATE TABLE "chat_message_media" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "mediaUploadId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "resourceType" "MediaResourceType" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER,
    "height" INTEGER,
    "duration" DOUBLE PRECISION,
    "bytes" INTEGER,
    "format" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_message_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_message_media_mediaUploadId_key" ON "chat_message_media"("mediaUploadId");

-- CreateIndex
CREATE INDEX "chat_message_media_messageId_sortOrder_idx" ON "chat_message_media"("messageId", "sortOrder");

-- AddForeignKey
ALTER TABLE "chat_message_media" ADD CONSTRAINT "chat_message_media_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_message_media" ADD CONSTRAINT "chat_message_media_mediaUploadId_fkey" FOREIGN KEY ("mediaUploadId") REFERENCES "media_uploads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
