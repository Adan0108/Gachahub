import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createClient } from 'redis';
import type { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { RedisIoAdapter } from './redis-io.adapter';

// Two real Socket.IO servers sharing a real Redis (REDIS_URL, default localhost), as two backend
// instances would. With no Redis running the tests are skipped, not failed.
// #99: before the adapter, an event emitted on one instance reached sockets on it only.
describe('Socket.IO across two backend instances (real Redis)', () => {
  jest.setTimeout(30_000);
  const adapters: RedisIoAdapter[] = [];
  const servers: Server[] = [];
  const clients: Socket[] = [];
  let redisUp = false;

  async function instance(): Promise<Server> {
    const adapter = new RedisIoAdapter(undefined as never);
    await adapter.connectToRedis();
    const server = adapter.createIOServer(0) as Server;
    server.on('connection', (socket) => {
      void socket.join(String(socket.handshake.query.room));
    });
    adapters.push(adapter);
    servers.push(server);
    return server;
  }

  async function client(server: Server, room: string): Promise<Socket> {
    const { port } = server.httpServer.address() as AddressInfo;
    const socket = connect(`http://localhost:${port}`, {
      transports: ['websocket'],
      query: { room },
    });
    clients.push(socket);
    await new Promise<void>((resolve) => socket.on('connect', () => resolve()));
    // The join happens on the server right after connect; give it a moment to reach Redis.
    await new Promise((resolve) => setTimeout(resolve, 200));
    return socket;
  }

  beforeAll(async () => {
    process.env.REDIS_KEY_PREFIX = `gachahub:test:${randomUUID()}:`;
    const probe = createClient({
      url: process.env.REDIS_URL ?? 'redis://localhost:6379',
      socket: { reconnectStrategy: false },
    });
    probe.on('error', () => undefined);
    try {
      await probe.connect();
      await probe.quit();
      redisUp = true;
    } catch {
      console.warn(
        'No Redis reachable: skipping the two-instance socket tests',
      );
    }
  });

  afterAll(async () => {
    clients.forEach((socket) => socket.disconnect());
    await Promise.all(
      servers.map((server, index) => adapters[index].close(server)),
    );
  });

  it('delivers an event emitted on one instance to a socket on the other', async () => {
    if (!redisUp) return;
    const [a, b] = [await instance(), await instance()];
    const bob = await client(b, 'user:bob');

    const received = new Promise((resolve) =>
      bob.on('message:created', resolve),
    );
    a.to('user:bob').emit('message:created', { messageId: 'm1' });

    await expect(received).resolves.toEqual({ messageId: 'm1' });
  });

  it('signs out a socket on the other instance, as SocketRegistry.endSessions does', async () => {
    if (!redisUp) return;
    const [a, b] = [
      servers[0] ?? (await instance()),
      servers[1] ?? (await instance()),
    ];
    const alice = await client(b, 'session:s1');

    const revoked = new Promise((resolve) =>
      alice.on('session:revoked', () => resolve(true)),
    );
    const closed = new Promise((resolve) => alice.on('disconnect', resolve));
    a.in('session:s1').emit('session:revoked');
    a.in('session:s1').disconnectSockets(true);

    await expect(revoked).resolves.toBe(true);
    await expect(closed).resolves.toBe('io server disconnect');
  });
});
