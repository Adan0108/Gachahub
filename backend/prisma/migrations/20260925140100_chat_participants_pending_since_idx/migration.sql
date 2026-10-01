-- If a failed build left an INVALID index, IF NOT EXISTS skips it: check pg_index.indisvalid, DROP INDEX CONCURRENTLY it, then re-run.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "chat_participants_pendingSince_pending_idx" ON "chat_participants"("pendingSince") WHERE "state" = 'PENDING';
