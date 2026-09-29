export const env = {
  // Fail-closed: an unset NODE_ENV (a bare `node dist/main`, a container
  // missing one env var, a CI smoke box) must land on the safe side, not
  // silently register dev-only routes (see dev.module.ts/dev.service.ts).
  // Local development sets this explicitly in .env.
  nodeEnv: process.env.NODE_ENV ?? 'production',
  port: Number(process.env.PORT || 3000),

  databaseUrl: process.env.DATABASE_URL,

  betterAuthUrl: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
  betterAuthSecret: process.env.BETTER_AUTH_SECRET,

  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
};
