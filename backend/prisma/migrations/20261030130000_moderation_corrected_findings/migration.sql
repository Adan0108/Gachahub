-- Preserve reversed evidence while allowing an explicit corrected finding.
-- Old unconditional unique indexes already guarantee upgrade compatibility.
DROP INDEX IF EXISTS "moderation_violations_caseId_key";
DROP INDEX IF EXISTS "moderation_violations_incidentKey_key";
CREATE UNIQUE INDEX "moderation_violations_active_case_key"
  ON moderation_violations ("caseId") WHERE "reversedAt" IS NULL;
CREATE UNIQUE INDEX "moderation_violations_active_incident_key"
  ON moderation_violations ("incidentKey") WHERE "reversedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "moderation_violations_caseId_idx" ON moderation_violations ("caseId");
CREATE INDEX IF NOT EXISTS "moderation_violations_incidentKey_idx" ON moderation_violations ("incidentKey");
