import type { PrismaClient } from '../generated/prisma/client';
import type { LoadedValue, SessionLoader } from './session-storage';

function secondsUntil(expiresAt: Date, now: number): number {
  return Math.floor((expiresAt.getTime() - now) / 1000);
}

/** Fills the login cache from the database, in the shapes better-auth writes: `{ session, user }` per token, and `[{ token, expiresAt }]` per user. */
export function createPrismaSessionLoader(
  prisma: Pick<PrismaClient, 'session'>,
): SessionLoader {
  return {
    async session(token): Promise<LoadedValue | null> {
      const row = await prisma.session.findUnique({
        where: { token },
        include: { user: true },
      });
      const ttlSeconds = row ? secondsUntil(row.expiresAt, Date.now()) : 0;
      if (!row || ttlSeconds <= 0) return null;

      const { user, ...session } = row;
      return { value: JSON.stringify({ session, user }), ttlSeconds };
    },

    async activeSessions(userId): Promise<LoadedValue | null> {
      const now = Date.now();
      const rows = await prisma.session.findMany({
        where: { userId, expiresAt: { gt: new Date(now) } },
        select: { token: true, expiresAt: true },
      });
      if (rows.length === 0) return null;

      const furthest = Math.max(...rows.map((row) => row.expiresAt.getTime()));
      return {
        value: JSON.stringify(
          rows.map((row) => ({
            token: row.token,
            expiresAt: row.expiresAt.getTime(),
          })),
        ),
        ttlSeconds: secondsUntil(new Date(furthest), now),
      };
    },
  };
}
