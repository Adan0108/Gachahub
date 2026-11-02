import { trustedApplicationOrigins } from '../common/security/request-origin.interceptor';
import { env } from './env';

export const appConfig = {
  trustedOrigins: trustedApplicationOrigins(),
  port: env.port,
  frontendUrl: env.frontendUrl,
  betterAuthUrl: env.betterAuthUrl,
};
