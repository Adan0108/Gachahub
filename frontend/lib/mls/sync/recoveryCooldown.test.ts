import { describe, expect, it } from 'vitest';
import { RECOVERY_COOLDOWN_MS, RecoveryCooldown } from './recoveryCooldown';

describe('RecoveryCooldown', () => {
  it('allows one try per window and reports how long is left', () => {
    let now = 1_000;
    const cooldown = new RecoveryCooldown(() => now);

    expect(cooldown.remainingMs('c')).toBe(0);
    expect(cooldown.tryStart('c')).toBe(true);
    expect(cooldown.tryStart('c')).toBe(false);
    now += 60_000;
    expect(cooldown.remainingMs('c')).toBe(RECOVERY_COOLDOWN_MS - 60_000);

    now += RECOVERY_COOLDOWN_MS;
    expect(cooldown.remainingMs('c')).toBe(0);
    expect(cooldown.tryStart('c')).toBe(true);
  });

  it('keeps conversations apart and forgets everything on clear', () => {
    const cooldown = new RecoveryCooldown(() => 5);

    cooldown.tryStart('a');

    expect(cooldown.tryStart('b')).toBe(true);
    cooldown.clear();
    expect(cooldown.tryStart('a')).toBe(true);
  });
});
