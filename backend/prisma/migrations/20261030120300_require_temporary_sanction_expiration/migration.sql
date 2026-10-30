-- SQL CHECK treats UNKNOWN as valid; make the nullability rule explicit.
ALTER TABLE moderation_sanctions ADD CONSTRAINT temporary_sanction_requires_expiration
CHECK (type='WARNING' OR "expiresAt" IS NOT NULL);
