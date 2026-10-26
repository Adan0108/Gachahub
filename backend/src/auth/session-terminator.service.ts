import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { RedisClientType } from 'redis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { SocketRegistry } from '../websocket/socket-registry.service';
import { auth } from './auth';

// Every backend instance listens here, so sockets connected to another instance are signed out too.
const SESSIONS_ENDED_CHANNEL = `${process.env.REDIS_KEY_PREFIX ?? 'gachahub:dev:'}sessions-ended`;

/** Ends logins the way better-auth itself does, then tells any open browser of them, on any instance, it is signed out. */
@Injectable()
export class SessionTerminator implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SessionTerminator.name);
  private subscriber?: RedisClientType;

  constructor(
    private readonly sockets: SocketRegistry,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
  ) {}

  async onModuleInit() {
    this.subscriber = this.redis.duplicate();
    this.subscriber.on('error', (error: Error) =>
      this.logger.error('Sign-out channel error', error.stack),
    );
    await this.subscriber.connect();
    await this.subscriber.subscribe(SESSIONS_ENDED_CHANNEL, (message) =>
      this.sockets.endSessions(JSON.parse(message) as string[]),
    );
  }

  async onApplicationShutdown() {
    if (this.subscriber?.isOpen) await this.subscriber.quit();
  }

  async end(
    sessions: ReadonlyArray<{ id: string; token: string }>,
  ): Promise<void> {
    const { internalAdapter } = await auth.$context;
    const results = await Promise.allSettled(
      sessions.map((session) => internalAdapter.deleteSession(session.token)),
    );

    const ended = sessions
      .filter((_, index) => results[index].status === 'fulfilled')
      .map((session) => session.id);
    // This instance's sockets at once; the others hear it on the channel. Missing that message
    // only delays them until SocketSessionWatcher's next recheck, which reads the shared cache.
    this.sockets.endSessions(ended);
    if (ended.length > 0) {
      await this.redis
        .publish(SESSIONS_ENDED_CHANNEL, JSON.stringify(ended))
        .catch((error: Error) =>
          this.logger.warn(`Could not tell other instances: ${error.message}`),
        );
    }

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
