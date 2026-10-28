import { Logger } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'node:http';
import type { Socket } from 'socket.io';
import { auth } from '../auth/auth';

const logger = new Logger('SocketAuth');

export type SocketIdentity = {
  userId: string;
  sessionId: string;
  expiresAt: number;
};

/**
 * Who a socket is, by the same session check REST already trusts: the handshake is plain HTTP,
 * so its cookie works the same way. `disableRefresh` checks without extending the login.
 */
export async function authenticateSocket(
  socket: Pick<Socket, 'handshake'>,
  query?: { disableRefresh: true },
): Promise<SocketIdentity | 'no-session' | 'error'> {
  try {
    const result = await auth.api.getSession({
      headers: toHeaders(socket.handshake.headers),
      ...(query ? { query } : {}),
    });

    return result
      ? {
          userId: result.user.id,
          sessionId: result.session.id,
          expiresAt: new Date(result.session.expiresAt).getTime(),
        }
      : 'no-session';
  } catch (error) {
    logger.warn(`Socket auth failed: ${(error as Error).message}`);
    return 'error';
  }
}

/** getSession() needs real Headers, not the plain object the socket gives. */
function toHeaders(raw: IncomingHttpHeaders): Headers {
  const headers = new Headers();

  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') {
      headers.set(key, value);
    }
  }

  return headers;
}
