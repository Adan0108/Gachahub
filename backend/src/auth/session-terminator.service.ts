import { Injectable } from '@nestjs/common';
import { SocketRegistry } from '../websocket/socket-registry.service';
import { auth } from './auth';

/** Ends logins the way better-auth itself does, then tells any open browser of them it is signed out. */
@Injectable()
export class SessionTerminator {
  constructor(private readonly sockets: SocketRegistry) {}

  async end(
    sessions: ReadonlyArray<{ id: string; token: string }>,
  ): Promise<void> {
    const { internalAdapter } = await auth.$context;
    const results = await Promise.allSettled(
      sessions.map((session) => internalAdapter.deleteSession(session.token)),
    );

    this.sockets.endSessions(
      sessions
        .filter((_, index) => results[index].status === 'fulfilled')
        .map((session) => session.id),
    );

    const failed = results.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
  }
}
