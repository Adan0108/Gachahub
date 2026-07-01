import { env } from './env';

export const appConfig = {
  port: env.port,
  frontendUrl: env.frontendUrl,
  betterAuthUrl: env.betterAuthUrl,
};
