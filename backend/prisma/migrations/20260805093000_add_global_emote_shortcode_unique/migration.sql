-- Global emotes (scope = 'GLOBAL') carry a NULL "gameId", and PostgreSQL treats NULLs as
-- distinct inside a unique index. That makes "chat_emotes_scope_gameId_shortcode_key" a
-- no-op for global rows: the same global shortcode could be inserted any number of times.
-- A partial unique index closes the gap on every supported PostgreSQL version
-- (NULLS NOT DISTINCT would restrict the deployment to PostgreSQL 15+).
CREATE UNIQUE INDEX "chat_emotes_global_shortcode_key"
  ON "chat_emotes" ("shortcode")
  WHERE "gameId" IS NULL;
