/** Runs `task` while holding a lock shared by every tab of this browser profile; without the Web Locks API it just runs. */
export function withCrossTabLock<T>(name: string, task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) return task();

  return locks.request(name, { mode: 'exclusive' }, task) as Promise<T>;
}
