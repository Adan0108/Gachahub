-- CreateEnum
CREATE TYPE "MessageRequestSetting" AS ENUM ('EVERYONE', 'FOLLOWERS', 'NO_ONE');

-- AlterTable
ALTER TABLE "user" ADD COLUMN "messageRequestSetting" "MessageRequestSetting" NOT NULL DEFAULT 'EVERYONE';
