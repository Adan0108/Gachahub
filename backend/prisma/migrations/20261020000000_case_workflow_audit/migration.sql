-- Workflow now targets ModerationCase directly. Preserve historical report audit rows.
ALTER TYPE "AuditAction" ADD VALUE 'CASE_CLAIMED';
ALTER TYPE "AuditAction" ADD VALUE 'CASE_RESOLVED';
ALTER TYPE "AuditAction" ADD VALUE 'CASE_DISMISSED';
ALTER TYPE "AuditTargetType" ADD VALUE 'MODERATION_CASE';
