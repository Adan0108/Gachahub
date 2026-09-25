import { describe, expect, it } from 'vitest';
import {
  GroupStateCorruptedError,
  GroupStateUnavailableError,
  MembershipMismatchError,
} from '../contract/errors';
import {
  MAX_RETRY_ATTEMPTS,
  nextRetryDelayMs,
  recoveryRetryDelayMs,
  shouldRetryDecrypt,
} from './decryptRetry';

describe('nextRetryDelayMs', () => {
  it('doubles each attempt, starting at 5 seconds', () => {
    expect([0, 1, 2, 3].map(nextRetryDelayMs)).toEqual([5_000, 10_000, 20_000, 40_000]);
  });

  it('never waits more than a minute', () => {
    expect(nextRetryDelayMs(4)).toBe(60_000);
    expect(nextRetryDelayMs(50)).toBe(60_000);
  });
});

describe('shouldRetryDecrypt', () => {
  it('retries after a network failure', () => {
    expect(shouldRetryDecrypt(new TypeError('Failed to fetch'), 0)).toBe(true);
  });

  it('does not retry when the sync did not fail', () => {
    expect(shouldRetryDecrypt(undefined, 0)).toBe(false);
  });

  it('does not retry a group refused on purpose or missing locally', () => {
    expect(shouldRetryDecrypt(new MembershipMismatchError('c', 'bad'), 0)).toBe(false);
    expect(shouldRetryDecrypt(new GroupStateUnavailableError('c'), 0)).toBe(false);
  });

  it('gives up after the cap', () => {
    expect(shouldRetryDecrypt(new Error('offline'), MAX_RETRY_ATTEMPTS - 1)).toBe(true);
    expect(shouldRetryDecrypt(new Error('offline'), MAX_RETRY_ATTEMPTS)).toBe(false);
  });
});

describe('recoveryRetryDelayMs', () => {
  it('waits out the cooldown, plus a moment, for a group that could not be recovered yet', () => {
    expect(recoveryRetryDelayMs(new GroupStateCorruptedError('c'), 30_000, 0)).toBe(31_000);
    expect(recoveryRetryDelayMs(new GroupStateUnavailableError('c'), 30_000, 0)).toBe(31_000);
  });

  it('retries once only', () => {
    expect(recoveryRetryDelayMs(new GroupStateCorruptedError('c'), 30_000, 1)).toBeUndefined();
  });

  it('does not wait when no cooldown is running, or for any other failure', () => {
    expect(recoveryRetryDelayMs(new GroupStateCorruptedError('c'), 0, 0)).toBeUndefined();
    expect(recoveryRetryDelayMs(new MembershipMismatchError('c', 'bad'), 30_000, 0)).toBeUndefined();
    expect(recoveryRetryDelayMs(undefined, 30_000, 0)).toBeUndefined();
  });
});
