import { CrossTabLockUnavailableError } from '../contract/errors';

/**
 * Runs `task` while holding a lock shared by every tab of this browser profile. Without the Web
 * Locks API nothing stops two tabs from using the same sender generation, so it refuses to run.
 */
export function withCrossTabLock<T>(name: string, task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) return Promise.reject(new CrossTabLockUnavailableError());

  return locks.request(name, { mode: 'exclusive' }, task) as Promise<T>;
}
