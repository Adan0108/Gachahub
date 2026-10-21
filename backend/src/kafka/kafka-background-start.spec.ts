import { Logger } from '@nestjs/common';
import { KafkaBackgroundStart } from './kafka-background-start';

describe('Kafka background startup', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns immediately, serializes attempts, recovers, and cancels retries on shutdown', async () => {
    const connect = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const disconnect = jest
      .fn<Promise<void>, []>()
      .mockResolvedValue(undefined);
    const startup = new KafkaBackgroundStart(
      connect,
      disconnect,
      new Logger('test'),
    );
    expect(startup.start()).toBeUndefined();
    startup.start();
    await startup.waitForAttempt();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(startup.connected).toBe(false);
    await jest.advanceTimersByTimeAsync(2_000);
    await startup.waitForAttempt();
    expect(startup.connected).toBe(true);
    await startup.stop();
    await jest.advanceTimersByTimeAsync(20_000);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(startup.connected).toBe(false);
  });

  it('does not reconnect if shutdown races an unfinished connection', async () => {
    let finish!: () => void;
    const connect = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const disconnect = jest
      .fn<Promise<void>, []>()
      .mockResolvedValue(undefined);
    const startup = new KafkaBackgroundStart(
      connect,
      disconnect,
      new Logger('test'),
    );
    startup.start();
    const stopping = startup.stop();
    finish();
    await stopping;
    await jest.advanceTimersByTimeAsync(20_000);
    expect(startup.connected).toBe(false);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(2);
  });
});
