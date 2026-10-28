import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { INestApplicationContext } from '@nestjs/common';
import type { Server, ServerOptions } from 'socket.io';
import { createClient, type RedisClientType } from 'redis';

/**
 * Socket.IO over Redis pub/sub: an event emitted to a room on one backend instance reaches the
 * sockets in that room on every instance (chat, typing, presence, notifications, sign-outs).
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private clients: RedisClientType[] = [];

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    // Typed like RedisModule's client: the adapter's types expect the general client type
    const pubClient = createClient({
      url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    }) as RedisClientType;
    const subClient = pubClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    this.clients = [pubClient, subClient];
    this.adapterConstructor = createAdapter(pubClient, subClient, {
      // Instances sharing one Redis for different environments must not hear each other.
      key: `${process.env.REDIS_KEY_PREFIX ?? 'gachahub:dev:'}socket.io`,
    });
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }

  async close(server: unknown): Promise<void> {
    await super.close(server as never);
    await Promise.all(
      this.clients
        .filter((client) => client.isOpen)
        .map((client) => client.quit()),
    );
  }
}
