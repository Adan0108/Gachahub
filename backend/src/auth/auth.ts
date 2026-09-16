import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { PrismaClient } from '../generated/prisma/client';

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

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',

  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),

  emailAndPassword: {
    enabled: true,
  },

  // Without this, every authenticated request - including every chat
  // send - does its own DB lookup just to validate the session cookie,
  // on top of whatever the route itself needs. cookieCache lets
  // better-auth verify a short-lived signed cache of the session instead
  // for up to maxAge, cutting that to roughly one DB check per minute of
  // activity instead of one per request. Signed, not just encoded, so it
  // can't be forged client-side; a revoked session can still act for up
  // to maxAge, the standard, documented trade-off for this feature - kept
  // short here so that window stays negligible.
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60,
    },
  },

  trustedOrigins: [process.env.FRONTEND_URL || 'http://localhost:5173'],
});
