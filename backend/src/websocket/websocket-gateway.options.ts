import { appConfig } from '../config/app.config';
import type { IncomingMessage } from 'node:http';

// shared by every gateway so they all attach to the same CORS-enabled server
export const websocketGatewayOptions = {
  // Browser WebSocket upgrades do not enforce CORS; authorize their Origin explicitly.
  allowRequest: (
    request: IncomingMessage,
    done: (error: string | null | undefined, allowed: boolean) => void,
  ) => {
    const origin = request.headers.origin;
    done(
      null,
      typeof origin === 'string' && appConfig.trustedOrigins.includes(origin),
    );
  },
  cors: {
    origin: appConfig.trustedOrigins,
    credentials: true,
  },
};
