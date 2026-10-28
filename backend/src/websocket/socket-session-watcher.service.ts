import { Injectable } from '@nestjs/common';
import { authenticateSocket } from './socket-auth';
import type { AppSocket } from './websocket.gateway';

// A login is checked again when it expires and at least this often, so a socket whose login
// expired or was deleted stops receiving within this long even if no revoke reached it.
const SESSION_RECHECK_MS = 10 * 60_000;
// After a backend hiccup during a recheck, try again this soon instead of dropping the socket.
const SESSION_RETRY_MS = 60_000;

/** Keeps each socket's login valid for as long as the socket lives: ends it once the login does. */
@Injectable()
export class SocketSessionWatcher {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  /** Checks the login now, then again at its expiry; a gone or expired login ends the socket. */
  async check(socket: AppSocket): Promise<void> {
    if (socket.disconnected) return;
    // disableRefresh: an open socket must not keep a login alive that the person stopped using.
    const identity = await authenticateSocket(socket, { disableRefresh: true });
    if (socket.disconnected) return;

    if (identity === 'no-session') {
      socket.emit('session:revoked');
      socket.disconnect(true);
      return;
    }
    if (identity === 'error') {
      if ((socket.data.sessionExpiresAt ?? 0) <= Date.now()) {
        socket.disconnect(true);
        return;
      }
      this.schedule(socket, SESSION_RETRY_MS);
      return;
    }

    socket.data.sessionExpiresAt = identity.expiresAt;
    this.schedule(socket, identity.expiresAt - Date.now());
  }

  /** Stops checking a socket that has gone. */
  forget(socket: AppSocket) {
    clearTimeout(this.timers.get(socket.id));
    this.timers.delete(socket.id);
  }

  private schedule(socket: AppSocket, delayMs: number) {
    clearTimeout(this.timers.get(socket.id));
    const timer = setTimeout(
      () => void this.check(socket),
      Number.isFinite(delayMs)
        ? Math.max(0, Math.min(delayMs, SESSION_RECHECK_MS))
        : SESSION_RECHECK_MS,
    );
    timer.unref?.();
    this.timers.set(socket.id, timer);
  }
}
