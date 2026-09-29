import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';
import { sessionRoom } from './socket.util';

// shared server ref, breaks gateway <-> delivery-service circular dependencies
@Injectable()
export class SocketRegistry {
  server?: Server;

  /** Tells the browsers of these logins they are signed out, then closes their sockets. */
  endSessions(sessionIds: string[]): void {
    for (const sessionId of sessionIds) {
      const room = this.server?.in(sessionRoom(sessionId));
      room?.emit('session:revoked');
      room?.disconnectSockets(true);
    }
  }
}
