-- DropIndex
DROP INDEX "comments_parentId_idx";

-- CreateIndex
CREATE INDEX "comments_parentId_createdAt_idx" ON "comments"("parentId", "createdAt");

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
