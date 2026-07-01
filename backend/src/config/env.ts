export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),

  databaseUrl: process.env.DATABASE_URL,

  betterAuthUrl: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
  betterAuthSecret: process.env.BETTER_AUTH_SECRET,

  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
};
