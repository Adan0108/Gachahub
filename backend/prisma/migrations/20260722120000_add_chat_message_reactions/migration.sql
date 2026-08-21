CREATE TYPE "ChatMessageReactionType" AS ENUM ('LIKE', 'LOVE', 'LAUGH', 'WOW', 'SAD', 'ANGRY');

CREATE TABLE "chat_message_reactions" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "ChatMessageReactionType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_message_reactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_message_reactions_messageId_userId_key"
ON "chat_message_reactions"("messageId", "userId");

CREATE INDEX "chat_message_reactions_messageId_idx"
ON "chat_message_reactions"("messageId");

CREATE INDEX "chat_message_reactions_userId_idx"
ON "chat_message_reactions"("userId");

ALTER TABLE "chat_message_reactions"
ADD CONSTRAINT "chat_message_reactions_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "chat_messages"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_message_reactions"
ADD CONSTRAINT "chat_message_reactions_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "user"("id")
ON DELETE CASCADE ON UPDATE CASCADE;