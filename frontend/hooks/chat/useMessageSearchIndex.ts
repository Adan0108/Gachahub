'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { acquireMessageSearchIndex, localMessageSearchIndex } from '../../lib/chat/localMessageSearch';

/**
 * The local message search index, filled while `enabled`. `version` changes whenever messages are
 * added or removed (and now and then while it is still filling), so a search result that depends
 * on the index can be recomputed from it. `indexed` of `total` is how far the filling has got.
 */
export function useMessageSearchIndex(enabled = true) {
  useEffect(() => (enabled ? acquireMessageSearchIndex() : undefined), [enabled]);

  const { status, version, indexed, total } = useSyncExternalStore(
    localMessageSearchIndex.subscribe,
    localMessageSearchIndex.getSnapshot,
    localMessageSearchIndex.getSnapshot,
  );
  return { index: localMessageSearchIndex, status, version, indexed, total };
}
