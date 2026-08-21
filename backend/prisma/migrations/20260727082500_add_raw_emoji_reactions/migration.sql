-- Allow normal keyboard emoji reactions without requiring a ChatEmote row.
ALTER TABLE "chat_message_reactions" ADD COLUMN "emoji" TEXT;
