import { ForbiddenException } from '@nestjs/common';
import type {
  ChatParticipantRole,
  Prisma,
} from '../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

export const GROUP_MANAGER_ROLES: ChatParticipantRole[] = ['OWNER', 'ADMIN'];
export const GROUP_MEMBER_ROLES: ChatParticipantRole[] = [
  'OWNER',
  'ADMIN',
  'MEMBER',
];

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

/**
 * Takes the lock, then confirms the actor is still an active member holding one of `roles`.
 * The permission check before the transaction can be stale by now: a demotion or removal
 * that lands in between must stop the write.
 */
export async function lockAndAssertActorRole(
  tx: Prisma.TransactionClient,
  conversationId: string,
  actorId: string,
  roles: ChatParticipantRole[],
): Promise<void> {
  await lockConversation(tx, conversationId);

  const actor = await tx.chatParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId: actorId } },
    select: { state: true, role: true },
  });

  if (!actor || actor.state !== 'ACTIVE' || !roles.includes(actor.role)) {
    throw new ForbiddenException('Your role in this group changed');
  }
}

/** Runs `work` in a transaction that first takes the lock and rechecks the actor's role (see above). */
export function inTransactionAsRole<T>(
  prisma: PrismaService,
  conversationId: string,
  actorId: string,
  roles: ChatParticipantRole[],
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await lockAndAssertActorRole(tx, conversationId, actorId, roles);
    return work(tx);
  });
}
