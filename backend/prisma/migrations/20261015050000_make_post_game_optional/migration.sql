BEGIN;

-- Generated with Prisma migrate diff and inspected before applying.
ALTER TABLE "posts" DROP CONSTRAINT "posts_gameId_fkey";
ALTER TABLE "posts" ALTER COLUMN "gameId" DROP NOT NULL,
ALTER COLUMN "type" DROP NOT NULL,
ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "posts" ADD CONSTRAINT "posts_gameId_fkey"
  FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A removed Game converts surviving posts to personal posts. PostgreSQL's FK
-- SET NULL must also clear classification, including categories not yet cascaded.
CREATE FUNCTION clear_detached_post_classification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."gameId" IS NOT NULL AND NEW."gameId" IS NULL THEN
    NEW."type" := NULL;
    NEW."categoryId" := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER posts_clear_detached_classification
  BEFORE UPDATE OF "gameId" ON "posts"
  FOR EACH ROW EXECUTE FUNCTION clear_detached_post_classification();

ALTER TABLE "posts" ADD CONSTRAINT "posts_classification_check" CHECK (
  ("gameId" IS NULL AND "type" IS NULL AND "categoryId" IS NULL)
  OR ("gameId" IS NOT NULL AND "type" IS NOT NULL)
);

COMMIT;
