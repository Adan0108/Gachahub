-- Blocking a direct chat used to hide it for good by setting the blocker's participant state
-- to BLOCKED, with no way back. A block is now the reversible user block and the chat stays in
-- the list, so every chat stuck in that state becomes a normal one plus a user block.

INSERT INTO "chat_user_blocks" ("id", "blockerId", "blockedId", "createdAt")
SELECT gen_random_uuid()::text, mine."userId", other."userId", NOW()
FROM "chat_participants" mine
JOIN "chat_conversations" c ON c."id" = mine."conversationId" AND c."type" = 'DIRECT'
JOIN "chat_participants" other
  ON other."conversationId" = mine."conversationId" AND other."userId" <> mine."userId"
WHERE mine."state" = 'BLOCKED'
ON CONFLICT DO NOTHING;

UPDATE "chat_participants"
SET "state" = 'ACTIVE', "blockedAt" = NULL
WHERE "state" = 'BLOCKED';
