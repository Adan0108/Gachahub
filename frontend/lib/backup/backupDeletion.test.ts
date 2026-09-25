import { describe, expect, it } from 'vitest';
import { formatDeletionDate, recoveryKeyMessage } from './backupDeletion';
import { RecoveryKeyError } from './backupKey';

describe('formatDeletionDate', () => {
  it('formats an ISO date', () => {
    expect(formatDeletionDate('2026-10-02T12:00:00.000Z', 'en-US')).toBe('October 2, 2026');
  });

  it('is null for nothing scheduled or garbage', () => {
    expect(formatDeletionDate(null)).toBeNull();
    expect(formatDeletionDate(undefined)).toBeNull();
    expect(formatDeletionDate('not a date')).toBeNull();
  });
});

describe('recoveryKeyMessage', () => {
  it('explains a malformed key', () => {
    expect(recoveryKeyMessage(new RecoveryKeyError('checksum'), 'x')).toMatch(/typo/);
    expect(recoveryKeyMessage(new RecoveryKeyError('length'), 'x')).toMatch(/wrong length/);
  });

  it('says a key the server refused does not match', () => {
    expect(recoveryKeyMessage(Object.assign(new Error('no'), { status: 403 }), 'x')).toBe(
      'That key does not match this backup.',
    );
  });

  it('falls back for anything else', () => {
    expect(recoveryKeyMessage(new Error('offline'), 'Try again.')).toBe('Try again.');
  });
});
