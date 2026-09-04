// keeps only timestamps still inside the window
export function pruneOldTimestamps(
  timestamps: number[],
  now: number,
  windowMs: number,
): number[] {
  const windowStart = now - windowMs;
  return timestamps.filter((timestamp) => timestamp > windowStart);
}

// moves a key to the most-recently-used end so it survives eviction longer
export function touch<StoredValue>(
  map: Map<string, StoredValue>,
  key: string,
  value: StoredValue,
): void {
  map.delete(key);
  map.set(key, value);
}

// evicts the least-recently-touched key once the map is at capacity
export function evictOldestIfAtCapacity<StoredValue>(
  map: Map<string, StoredValue>,
  maxSize: number,
  keyAboutToBeAdded?: string,
): void {
  if (
    (keyAboutToBeAdded === undefined || !map.has(keyAboutToBeAdded)) &&
    map.size >= maxSize
  ) {
    const [oldestKey] = map.keys();
    map.delete(oldestKey);
  }
}
