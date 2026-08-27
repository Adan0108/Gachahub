-- CreateIndex
CREATE INDEX "posts_status_visibility_deletedAt_createdAt_id_idx" ON "posts"("status", "visibility", "deletedAt", "createdAt", "id");
