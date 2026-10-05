CREATE EXTENSION IF NOT EXISTS citext;

ALTER TABLE "user" ADD COLUMN "username" CITEXT;
ALTER TABLE "user" ADD COLUMN "onboarded" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "user_username_key" ON "user"("username");

-- Every account that exists before this migration is already using the app;
-- only accounts created from here on need to go through onboarding.
UPDATE "user" SET "onboarded" = true;
