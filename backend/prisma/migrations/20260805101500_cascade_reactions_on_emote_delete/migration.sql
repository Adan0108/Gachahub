-- "chat_emotes" cascades from "games", but "chat_message_reactions" restricted on
-- "emoteId", so deleting a Game whose emotes had ever been reacted to aborted the entire
-- delete with a foreign key violation. Cascade instead: a hard-deleted emote takes its
-- reactions with it. SetNull is not an option because a reaction must carry exactly one of
-- "emoji" / "emoteId", and nulling "emoteId" would leave a reaction with no content.
ALTER TABLE "chat_message_reactions" DROP CONSTRAINT "chat_message_reactions_emoteId_fkey";

ALTER TABLE "chat_message_reactions" ADD CONSTRAINT "chat_message_reactions_emoteId_fkey"
  FOREIGN KEY ("emoteId") REFERENCES "chat_emotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
