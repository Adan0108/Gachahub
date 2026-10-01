-- If a failed build left an INVALID index, IF NOT EXISTS skips it: check pg_index.indisvalid, DROP INDEX CONCURRENTLY it, then re-run.
-- Serves the picker's ILIKE on name (users.repository searchByName); a plain gin_trgm_ops index, since ILIKE does not use lower(name).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "user_name_trgm_idx" ON "user" USING gin ("name" gin_trgm_ops);
