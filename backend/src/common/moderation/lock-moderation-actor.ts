import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { hasPlatformModerationCapability } from '../guards/moderation-capabilities';

/** Global case-write lock order: user rows (sorted), game assignments, then case.
 * SHARE prevents a role/status update or assignment deletion until commit. */
export async function lockModerationActor(
  tx: Prisma.TransactionClient,
  actorId: string,
  gameId?: string,
  assigneeId?: string,
) {
  const ids = [
    ...new Set([actorId, ...(assigneeId ? [assigneeId] : [])]),
  ].sort();
  await tx.$queryRaw`SELECT id FROM "user" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`;
  const actor = await tx.user.findUnique({
    where: { id: actorId },
    select: { role: true, status: true },
  });
  if (!actor || actor.status !== 'ACTIVE')
    throw new ForbiddenException('Active moderation permission required');
  if (hasPlatformModerationCapability(actor.role)) return;
  if (gameId !== undefined) {
    const assignments = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM game_moderators WHERE "userId" = ${actorId} AND "gameId" = ${gameId} FOR SHARE`;
    if (assignments.length) return;
  }
  throw new ForbiddenException('Moderation permission was removed');
}
