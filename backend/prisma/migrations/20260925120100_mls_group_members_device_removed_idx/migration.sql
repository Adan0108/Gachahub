-- If a failed build left an INVALID index, IF NOT EXISTS skips it: check pg_index.indisvalid, DROP INDEX CONCURRENTLY it, then re-run.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "mls_group_members_deviceId_removedEpoch_idx" ON "mls_group_members"("deviceId", "removedEpoch");
