import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { betterAuth } from 'better-auth';
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from 'better-auth/api';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { createClient, type RedisClientType } from 'redis';
import { PrismaClient } from '../generated/prisma/client';
import { createPrismaSessionLoader } from './session-loader';
import { RedisSessionStorage } from './session-storage';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is missing from .env');
}

const adapter = new PrismaPg({
  connectionString: databaseUrl,
});

const prisma = new PrismaClient({
  adapter,
});

// Its own connection, opened on first use: this module loads before Nest's RedisModule exists.
let redis: Promise<RedisClientType> | undefined;
const connectRedis = () =>
  (redis ??= (
    createClient({
      url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    }) as RedisClientType
  )
    .on('error', () => undefined)
    .connect()
    .catch((error: unknown) => {
      redis = undefined;
      throw error;
    }) as Promise<RedisClientType>);

const sessionStorage = new RedisSessionStorage(
  connectRedis,
  `${process.env.REDIS_KEY_PREFIX ?? 'gachahub:dev:'}auth:`,
  createPrismaSessionLoader(prisma),
);

export const auth = betterAuth({
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Better Auth owns these routes outside Nest's HTTP interceptors.
      // Login, logout and password recovery remain available for account safety.
      if (
        ![
          '/update-user',
          '/change-email',
          '/delete-user',
          '/link-social',
          '/unlink-account',
        ].includes(ctx.path)
      )
        return;
      const session = await getSessionFromCtx(ctx);
      if (!session) return;
      const now = new Date();
      const blocked = await prisma.moderationSanction.count({
        where: {
          subjectId: session.user.id,
          scope: 'PLATFORM',
          status: 'ACTIVE',
          type: { not: 'WARNING' },
          startsAt: { lte: now },
          expiresAt: { gt: now },
        },
      });
      if (blocked)
        throw new APIError('FORBIDDEN', {
          message:
            'Account restricted. Your moderation notices and appeals remain available.',
        });
    }),
  },
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',

  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),

  emailAndPassword: {
    enabled: true,
  },

  // Ending current sessions on a ban/suspend only covers logins that already exist - without this,
  // the same account signs in again a moment later with a fresh session. Catches every sign-in path
  // (email/password now, any provider added later) at the one place they all create a session.
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { status: true },
          });

          if (user?.status !== 'ACTIVE') {
            throw new APIError('FORBIDDEN', {
              message: 'This account is not active',
            });
          }

          return { data: session };
        },
      },
    },
  },

  // AdminGuard already re-checks role live against the DB for every guarded request - this is
  // only so the frontend can decide whether to show admin nav/pages at all. input: false so a
  // client can never set its own role/status through a profile update.
  user: {
    additionalFields: {
      role: { type: 'string', input: false },
      status: { type: 'string', input: false },
      // input: false - only UsersController's dedicated onboarding endpoint may set these,
      // never better-auth's own generic user-update path.
      username: { type: 'string', required: false, input: false },
      onboarded: { type: 'boolean', input: false },
    },
  },

  // Logins are looked up in this Redis cache, shared by every instance, not the database, and
  // deleting one takes effect everywhere at once. A cookieCache can't do that: it sits in the
  // browser and can't be revoked. A miss is filled from the database (see RedisSessionStorage).
  secondaryStorage: sessionStorage,
  // rate-limit counters stay in memory, out of the login cache
  rateLimit: { storage: 'memory' },
  session: {
    storeSessionInDatabase: true,
  },

  trustedOrigins: [process.env.FRONTEND_URL || 'http://localhost:5173'],
});
