import type { Prisma } from '../../generated/prisma/client';

/** Hands a moderator's open cases (within `where`) back to the queue: unassigned, Needs review. */
export function releaseModeratorCases(
  tx: Prisma.TransactionClient,
  userId: string,
  where: Prisma.ModerationCaseWhereInput = {},
) {
  return tx.moderationCase.updateMany({
    where: {
      ...where,
      assignedModeratorId: userId,
      status: { in: ['OPEN', 'IN_REVIEW'] },
    },
    data: { assignedModeratorId: null, status: 'OPEN' },
  });
}
