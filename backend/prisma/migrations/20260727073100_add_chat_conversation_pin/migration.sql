-- Add per-user inbox pinning for chat conversations.
ALTER TABLE "chat_participants" ADD COLUMN "pinnedAt" TIMESTAMP(3);
