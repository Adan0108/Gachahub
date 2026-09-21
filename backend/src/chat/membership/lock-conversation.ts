import type { Prisma } from '../../generated/prisma/client';

/**
 * Takes the conversation's row lock for the rest of the transaction. Accepting
 * a Commit takes the same lock (its epoch compare-and-set updates this row), so
 * a membership change and a Commit for one conversation can never interleave:
 * what a change read about the MLS roster is still true when it writes.
 */
export async function lockConversation(
  tx: Prisma.TransactionClient,
  conversationId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "chat_conversations" WHERE "id" = ${conversationId} FOR UPDATE`;
}
