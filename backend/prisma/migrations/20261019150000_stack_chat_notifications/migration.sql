-- Chat notifications stack: one unread row per person and conversation, with a count, instead of one per message
ALTER TABLE "notifications" ADD COLUMN "conversationId" TEXT;
ALTER TABLE "notifications" ADD COLUMN "count" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "notifications_recipientId_conversationId_idx" ON "notifications"("recipientId", "conversationId");

-- Rows made before this know their conversation through their message
UPDATE "notifications" n
SET "conversationId" = m."conversationId"
FROM "chat_messages" m
WHERE n."entityType" = 'MESSAGE' AND n."entityId" = m."id" AND n."conversationId" IS NULL;

UPDATE "notifications"
SET "conversationId" = "entityId"
WHERE "entityType" = 'CONVERSATION' AND "conversationId" IS NULL;

-- Old unread message rows become one stacked row per person and conversation, so the index above can exist
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "recipientId", "conversationId" ORDER BY "createdAt" DESC, id DESC) AS position,
         COUNT(*) OVER (PARTITION BY "recipientId", "conversationId") AS total
  FROM "notifications"
  WHERE "type" = 'MESSAGE_RECEIVED' AND "readAt" IS NULL AND "conversationId" IS NOT NULL
)
UPDATE "notifications" n
SET "count" = ranked.total
FROM ranked
WHERE n.id = ranked.id AND ranked.position = 1 AND ranked.total > 1;

DELETE FROM "notifications" n
USING (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "recipientId", "conversationId" ORDER BY "createdAt" DESC, id DESC) AS position
  FROM "notifications"
  WHERE "type" = 'MESSAGE_RECEIVED' AND "readAt" IS NULL AND "conversationId" IS NOT NULL
) older
WHERE n.id = older.id AND older.position > 1;

-- What makes the stacking safe under concurrency: a second message cannot open a second unread row
CREATE UNIQUE INDEX "notifications_unread_message_stack_key"
  ON "notifications"("recipientId", "conversationId")
  WHERE "type" = 'MESSAGE_RECEIVED' AND "readAt" IS NULL AND "conversationId" IS NOT NULL;
