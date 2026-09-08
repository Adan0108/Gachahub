-- Add per-participant "delete for me" soft delete for chat conversations.
ALTER TABLE "chat_participants" ADD COLUMN "deletedAt" TIMESTAMP(3);
