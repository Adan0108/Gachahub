-- A reaction carries exactly one of emoji or emote; NOT VALID enforces it on new writes without scanning old rows.
ALTER TABLE "chat_message_reactions"
ADD CONSTRAINT "chat_message_reactions_one_kind"
CHECK (("emoji" IS NULL) <> ("emoteId" IS NULL)) NOT VALID;
