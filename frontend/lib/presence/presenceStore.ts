import { api } from "../api";

const MAX_PER_REQUEST = 100;
const BATCH_DELAY_MS = 50;

export type PresenceStatus = "ONLINE" | "OFFLINE";
type PresenceMap = Record<string, PresenceStatus>;

/**
 * What the app knows about who is online: ONLINE or OFFLINE per person, filled in by batched
 * lookups and kept fresh by live updates. A person nobody has asked about reads as unknown
 * (undefined), so no dot is drawn until the answer arrives.
 */
export function createPresenceStore({
  fetchPresence = api.getPresence as (userIds: string[]) => Promise<PresenceMap>,
  delayMs = BATCH_DELAY_MS,
}: {
  fetchPresence?: (userIds: string[]) => Promise<PresenceMap>;
  delayMs?: number;
} = {}) {
  const statuses = new Map<string, PresenceStatus>();
  const listeners = new Set<() => void>();
  // Asked and not failed, so each person is looked up once; wanted also keeps the failures for refreshes.
  const asked = new Set<string>();
  const wanted = new Set<string>();
  let waiting = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Bumped by clear(), so a lookup that was already running cannot fill the store afterwards.
  let generation = 0;

  const notify = () => listeners.forEach((listener) => listener());

  const setMany = (entries: PresenceMap) => {
    let changed = false;
    for (const [userId, status] of Object.entries(entries)) {
      if (statuses.get(userId) === status) continue;
      statuses.set(userId, status);
      changed = true;
    }
    if (changed) notify();
  };

  const flush = async () => {
    timer = undefined;
    const run = generation;
    const ids = [...waiting];
    waiting = new Set();

    for (let start = 0; start < ids.length; start += MAX_PER_REQUEST) {
      if (run !== generation) return;
      const chunk = ids.slice(start, start + MAX_PER_REQUEST);
      try {
        const result = await fetchPresence(chunk);
        if (run === generation) setMany(result);
      } catch {
        // Still wanted, so the next refresh or the next row asking looks it up again.
        if (run === generation) chunk.forEach((id) => asked.delete(id));
      }
    }
  };

  const schedule = () => {
    if (timer === undefined) timer = setTimeout(flush, delayMs);
  };

  return {
    get: (userId: string) => statuses.get(userId),
    set: (userId: string, status: PresenceStatus) => setMany({ [userId]: status }),
    setMany,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Asks the server about this person once, together with whoever else asks in the same moment. */
    request(userId: string | null | undefined) {
      if (!userId) return;
      wanted.add(userId);
      if (asked.has(userId)) return;
      asked.add(userId);
      waiting.add(userId);
      schedule();
    },
    /** Updates may have been missed, or a lookup failed: ask again about everyone known or wanted. */
    refreshAll() {
      wanted.forEach((userId) => waiting.add(userId));
      statuses.forEach((_, userId) => waiting.add(userId));
      if (waiting.size > 0) schedule();
    },
    /** Forgets everyone, e.g. when signing out. */
    clear() {
      generation += 1;
      clearTimeout(timer);
      timer = undefined;
      waiting = new Set();
      asked.clear();
      wanted.clear();
      if (statuses.size > 0) {
        statuses.clear();
        notify();
      }
    },
  };
}

export const presenceStore = createPresenceStore();
