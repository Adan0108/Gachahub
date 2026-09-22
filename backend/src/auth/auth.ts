import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { PrismaClient } from '../generated/prisma/client';
import { createPrismaSessionLoader } from './session-loader';
import { InMemorySessionStorage } from './session-storage';

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

const sessionStorage = new InMemorySessionStorage(
  createPrismaSessionLoader(prisma),
);

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',

  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),

  emailAndPassword: {
    enabled: true,
  },

  // Logins are looked up in this server-side cache, not the database, and deleting one takes effect
  // at once. A cookieCache can't do that: it sits in the browser and can't be revoked. A miss is
  // filled from the database (see InMemorySessionStorage), so a restart only costs one read per login.
  secondaryStorage: sessionStorage,
  // rate-limit counters stay in memory, out of the login cache
  rateLimit: { storage: 'memory' },
  session: {
    storeSessionInDatabase: true,
  },

  trustedOrigins: [process.env.FRONTEND_URL || 'http://localhost:5173'],
});
