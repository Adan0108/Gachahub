type SessionCleanup = () => void | Promise<void>;

const cleanups = new Set<SessionCleanup>();

/** Registers something that must be dropped when the user logs out or the account changes. */
export function registerSessionCleanup(cleanup: SessionCleanup): () => void {
  cleanups.add(cleanup);
  return () => {
    cleanups.delete(cleanup);
  };
}

/** Runs every registered cleanup; one failing never stops the rest. */
export async function runSessionCleanups(): Promise<void> {
  await Promise.allSettled([...cleanups].map(async (cleanup) => cleanup()));
}
