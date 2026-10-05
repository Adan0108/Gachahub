import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SocketRegistry } from '../websocket/socket-registry.service';
import { auth } from './auth';

/** Ends logins the way better-auth itself does, then tells any open browser of them it is signed out. */
@Injectable()
export class SessionTerminator {
  constructor(
    private readonly sockets: SocketRegistry,
    private readonly prisma: PrismaService,
  ) {}

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

  /** Looks up every current login for a user, then ends them - the shared form of the find-then-end pattern callers otherwise repeat by hand. No-ops when the user has no active sessions. */
  async endAllForUser(userId: string): Promise<void> {
    const sessions = await this.prisma.session.findMany({
      where: { userId },
      select: { id: true, token: true },
    });

    if (sessions.length > 0) {
      await this.end(sessions);
    }
  }
}
