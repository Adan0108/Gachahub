jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
import { ReadinessService } from './readiness.service';

describe('ReadinessService', () => {
  let db: { $queryRaw: jest.Mock };
  let redis: { ping: jest.Mock };
  let kafka: { isConnected: boolean };
  let service: ReadinessService;

  beforeEach(() => {
    jest.useFakeTimers();
    db = { $queryRaw: jest.fn().mockResolvedValue([1]) };
    redis = { ping: jest.fn().mockResolvedValue('PONG') };
    kafka = { isConnected: true };
    service = new ReadinessService(db as never, kafka as never, redis as never);
  });
  afterEach(() => jest.useRealTimers());

  it('caches success until the one-second TTL expires', async () => {
    await expect(service.ready()).resolves.toEqual({ status: 'ready' });
    await jest.advanceTimersByTimeAsync(999);
    await service.ready();
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await service.ready();
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
    expect(redis.ping).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['postgres', 'redis', 'kafka'])(
    'caches a sanitized %s failure and recovers after expiration',
    async (dependency) => {
      if (dependency === 'postgres')
        db.$queryRaw.mockRejectedValue(new Error('secret'));
      if (dependency === 'redis')
        redis.ping.mockRejectedValue(new Error('secret'));
      if (dependency === 'kafka') kafka.isConnected = false;
      const first = service.ready();
      await expect(first).rejects.toMatchObject({
        status: 503,
        message: 'Required services are not ready',
      });
      expect(service.ready()).toBe(first);
      db.$queryRaw.mockResolvedValue([1]);
      redis.ping.mockResolvedValue('PONG');
      kafka.isConnected = true;
      await jest.advanceTimersByTimeAsync(1000);
      await expect(service.ready()).resolves.toEqual({ status: 'ready' });
    },
  );

  it('shares a single pending probe beyond the cache TTL', async () => {
    let release!: () => void;
    db.$queryRaw.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const first = service.ready();
    const requests = Array.from({ length: 100 }, () => service.ready());
    expect(requests.every((request) => request === first)).toBe(true);
    await jest.advanceTimersByTimeAsync(1500);
    expect(service.ready()).toBe(first);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    release();
    await Promise.all(requests);
    await service.ready();
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it.each(['postgres', 'redis'])(
    'times out a hung %s probe and allows a retry',
    async (dependency) => {
      const mock = dependency === 'postgres' ? db.$queryRaw : redis.ping;
      mock.mockImplementation(() => new Promise(() => undefined));
      const result = expect(service.ready()).rejects.toMatchObject({
        status: 503,
      });
      await jest.advanceTimersByTimeAsync(2000);
      await result;
      expect(jest.getTimerCount()).toBe(0);
      mock.mockResolvedValue('recovered');
      await jest.advanceTimersByTimeAsync(1000);
      await expect(service.ready()).resolves.toEqual({ status: 'ready' });
    },
  );

  it('also bounds the legacy health Redis probe', async () => {
    redis.ping.mockImplementation(() => new Promise(() => undefined));
    const result = expect(service.pingRedis()).rejects.toThrow(
      'Dependency timeout',
    );
    await jest.advanceTimersByTimeAsync(2000);
    await result;
    expect(jest.getTimerCount()).toBe(0);
  });
});
