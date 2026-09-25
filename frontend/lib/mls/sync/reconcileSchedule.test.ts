import { describe, expect, it } from 'vitest';
import { FULL_RECONCILE_INTERVAL_MS, nextReconcileScope } from './reconcileSchedule';

describe('nextReconcileScope', () => {
  it('skips the poll while the tab is hidden', () => {
    expect(nextReconcileScope(1000, null, true)).toBeNull();
  });

  it('walks the full list on the first poll', () => {
    expect(nextReconcileScope(1000, null, false)).toBe('full');
  });

  it('only checks pending work between full walks', () => {
    expect(nextReconcileScope(1000 + 5000, 1000, false)).toBe('pending');
  });

  it('walks the full list again once the interval has passed', () => {
    expect(nextReconcileScope(1000 + FULL_RECONCILE_INTERVAL_MS, 1000, false)).toBe('full');
  });
});
