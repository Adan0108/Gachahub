ALTER TABLE "chat_participants" ADD COLUMN IF NOT EXISTS "pendingSince" TIMESTAMP(3);

-- updatedAt is bumped by mute/read/pin so it misdates invites; give every open invite a fresh 14-day grace instead.
UPDATE "chat_participants" SET "pendingSince" = now() WHERE "state" = 'PENDING' AND "pendingSince" IS NULL;
