-- Closed cases permit future complaints; only active workflows are unique.
CREATE UNIQUE INDEX "moderation_cases_open_target_key"
ON "moderation_cases" ("targetType", "targetId")
WHERE "status" IN ('OPEN', 'IN_REVIEW');
