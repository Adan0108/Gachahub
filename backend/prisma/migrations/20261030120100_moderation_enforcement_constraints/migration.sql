-- Existing hides have no reliable scope provenance. Preserve them conservatively;
-- platform staff can review/reverse them without allowing a community override.
INSERT INTO content_enforcements (id, "targetType", "targetId", "subjectId", scope, "gameId", reason)
SELECT 'legacy-post-' || id, 'POST', id, "authorId", 'PLATFORM', "gameId", 'Restriction recorded before scoped enforcement; platform review required'
FROM posts WHERE status='HIDDEN' AND "deletedAt" IS NULL;

INSERT INTO content_enforcements (id, "targetType", "targetId", "subjectId", scope, "gameId", reason)
SELECT 'legacy-comment-' || c.id, 'COMMENT', c.id, c."authorId", 'PLATFORM', p."gameId", 'Restriction recorded before scoped enforcement; platform review required'
FROM comments c JOIN posts p ON p.id=c."postId" WHERE c.status='HIDDEN' AND c."deletedAt" IS NULL;

CREATE UNIQUE INDEX content_enforcements_active_scope_key ON content_enforcements ("targetType", "targetId", scope) WHERE "revokedAt" IS NULL;
ALTER TABLE content_enforcements ADD CONSTRAINT content_enforcement_scope_check CHECK (scope='PLATFORM' OR "gameId" IS NOT NULL);
ALTER TABLE moderation_violations ADD CONSTRAINT violation_scope_check CHECK ((scope='PLATFORM' AND "gameId" IS NULL) OR (scope='COMMUNITY' AND "gameId" IS NOT NULL));
ALTER TABLE moderation_sanctions ADD CONSTRAINT sanction_scope_check CHECK ((scope='PLATFORM' AND "gameId" IS NULL) OR (scope='COMMUNITY' AND "gameId" IS NOT NULL));
ALTER TABLE moderation_sanctions ADD CONSTRAINT sanction_type_scope_check CHECK (
  type='WARNING' OR (scope='COMMUNITY' AND type IN ('COMMUNITY_RESTRICTION','COMMUNITY_BAN')) OR
  (scope='PLATFORM' AND type='PLATFORM_SUSPENSION')
);
ALTER TABLE moderation_sanctions ADD CONSTRAINT sanction_duration_check CHECK (
  (type='WARNING' AND "expiresAt" IS NULL) OR
  (type<>'WARNING' AND "expiresAt" IS NOT NULL AND "expiresAt" >= "startsAt" + interval '1 day' AND "expiresAt" <= "startsAt" + interval '30 days')
);
ALTER TABLE moderation_sanctions ADD CONSTRAINT sanction_revocation_check CHECK ((status='REVOKED') = ("revokedAt" IS NOT NULL));
ALTER TABLE moderation_appeals ADD CONSTRAINT appeal_decision_check CHECK (
  (status='PENDING' AND "reviewedAt" IS NULL AND "decisionReason" IS NULL) OR
  (status IN ('ACCEPTED','REJECTED') AND "reviewedAt" IS NOT NULL AND "decisionReason" IS NOT NULL)
);
