import { describe, expect, it } from 'vitest';
import { MAX_RECONNECT_ATTEMPTS, reconnectDelayMs } from './socketReconnect';

describe('reconnectDelayMs', () => {
  it('doubles each attempt, starting at 1 second, jittered to 50-100% of the cap', () => {
    expect(reconnectDelayMs(0)).toBeGreaterThanOrEqual(500);
    expect(reconnectDelayMs(0)).toBeLessThanOrEqual(1_000);
    expect(reconnectDelayMs(3)).toBeGreaterThanOrEqual(4_000);
    expect(reconnectDelayMs(3)).toBeLessThanOrEqual(8_000);
  });

  it('never waits more than 30 seconds', () => {
    expect(reconnectDelayMs(10)).toBeLessThanOrEqual(30_000);
    expect(reconnectDelayMs(50)).toBeLessThanOrEqual(30_000);
  });

  it('gives up after a bounded number of consecutive failures', () => {
    expect(MAX_RECONNECT_ATTEMPTS).toBeGreaterThan(0);
    expect(Number.isFinite(MAX_RECONNECT_ATTEMPTS)).toBe(true);
  });
});
