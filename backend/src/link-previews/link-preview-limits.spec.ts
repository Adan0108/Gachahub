import { RateLimitedException } from '../common/exceptions/rate-limited.exception';
import {
  ConcurrencyGate,
  LinkPreviewRateLimiterService,
} from './link-preview-limits';

describe('LinkPreviewRateLimiterService', () => {
  it('allows twelve previews a minute and then says to slow down', () => {
    const limiter = new LinkPreviewRateLimiterService();

    for (let i = 0; i < 12; i += 1) {
      expect(() => limiter.assertNotRateLimited('user-1')).not.toThrow();
    }
    expect(() => limiter.assertNotRateLimited('user-1')).toThrow(
      RateLimitedException,
    );
  });

  it('counts each person separately', () => {
    const limiter = new LinkPreviewRateLimiterService();
    for (let i = 0; i < 12; i += 1) limiter.assertNotRateLimited('user-1');

    expect(() => limiter.assertNotRateLimited('user-2')).not.toThrow();
  });
});

describe('ConcurrencyGate', () => {
  const never = () => new Promise<never>(() => undefined);

  it('runs a task and gives back its result', async () => {
    await expect(
      new ConcurrencyGate(2).run(() => Promise.resolve('done')),
    ).resolves.toBe('done');
  });

  it('turns away work beyond the limit instead of queueing it', async () => {
    const gate = new ConcurrencyGate(2);
    void gate.run(never);
    void gate.run(never);

    await expect(gate.run(() => Promise.resolve('late'))).rejects.toThrow(
      RateLimitedException,
    );
  });

  it('tells the caller when to come back', async () => {
    const gate = new ConcurrencyGate(1);
    void gate.run(never);

    const error = (await gate
      .run(() => Promise.resolve())
      .catch((e: unknown) => e)) as RateLimitedException;

    expect(error).toBeInstanceOf(RateLimitedException);
    expect(error.message).toMatch(/try again/i);
  });

  it('frees a place when a task finishes', async () => {
    const gate = new ConcurrencyGate(1);

    await gate.run(() => Promise.resolve());

    await expect(gate.run(() => Promise.resolve('next'))).resolves.toBe('next');
  });

  it('frees a place when a task fails', async () => {
    const gate = new ConcurrencyGate(1);

    await expect(
      gate.run(() => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');

    await expect(gate.run(() => Promise.resolve('next'))).resolves.toBe('next');
  });
});
