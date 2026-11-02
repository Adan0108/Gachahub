-- Rows left behind by accounts deleted before these links existed would block the foreign keys.
DELETE FROM "counted_interactions" ci
WHERE NOT EXISTS (SELECT 1 FROM "user" u WHERE u."id" = ci."actorId")
   OR NOT EXISTS (SELECT 1 FROM "user" u WHERE u."id" = ci."ownerId");

DELETE FROM "daily_giver_reputation" dg
WHERE NOT EXISTS (SELECT 1 FROM "user" u WHERE u."id" = dg."ownerId")
   OR NOT EXISTS (SELECT 1 FROM "user" u WHERE u."id" = dg."giverId");

-- CreateIndex
CREATE INDEX "counted_interactions_actorId_idx" ON "counted_interactions"("actorId");

-- CreateIndex
CREATE INDEX "counted_interactions_ownerId_idx" ON "counted_interactions"("ownerId");

-- CreateIndex
CREATE INDEX "daily_giver_reputation_giverId_idx" ON "daily_giver_reputation"("giverId");

-- CreateIndex
CREATE INDEX "daily_giver_reputation_day_idx" ON "daily_giver_reputation"("day");

-- AddForeignKey
ALTER TABLE "daily_giver_reputation" ADD CONSTRAINT "daily_giver_reputation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_giver_reputation" ADD CONSTRAINT "daily_giver_reputation_giverId_fkey" FOREIGN KEY ("giverId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counted_interactions" ADD CONSTRAINT "counted_interactions_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counted_interactions" ADD CONSTRAINT "counted_interactions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

