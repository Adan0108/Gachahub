-- A concurrent author edit must never republish an active restriction or undo deletion.
-- Restorations first revoke eligible enforcement rows in the same transaction.
CREATE FUNCTION enforce_moderation_visibility() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (OLD."deletedAt" IS NOT NULL OR OLD.status::text='DELETED')
     AND (NEW."deletedAt" IS NULL OR NEW.status::text NOT IN ('DELETED')) THEN
    RAISE EXCEPTION 'Deleted content cannot be republished' USING ERRCODE='23514';
  END IF;
  IF NEW.status::text NOT IN ('HIDDEN','DELETED') AND EXISTS (
    SELECT 1 FROM content_enforcements e
    WHERE e."targetType"::text=TG_ARGV[0] AND e."targetId"=NEW.id AND e."revokedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Active moderation restriction prevents publication' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER posts_enforcement_visibility BEFORE UPDATE OF status, "deletedAt" ON posts
FOR EACH ROW EXECUTE FUNCTION enforce_moderation_visibility('POST');
CREATE TRIGGER comments_enforcement_visibility BEFORE UPDATE OF status, "deletedAt" ON comments
FOR EACH ROW EXECUTE FUNCTION enforce_moderation_visibility('COMMENT');
