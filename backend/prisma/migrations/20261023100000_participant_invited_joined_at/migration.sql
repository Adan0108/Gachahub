-- When a person was invited and when they became a member, so a chat can say "invited" at the
-- invite, "joined" at the accept, and nothing for a declined invite.
ALTER TABLE "chat_participants" ADD COLUMN "invitedAt" TIMESTAMP(3);
ALTER TABLE "chat_participants" ADD COLUMN "joinedAt" TIMESTAMP(3);

-- Open invites already know when they were sent.
UPDATE "chat_participants" SET "invitedAt" = "pendingSince" WHERE "state" = 'PENDING';
