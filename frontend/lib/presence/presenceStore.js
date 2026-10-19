import { api } from "../api";

const MAX_PER_REQUEST = 100;
const BATCH_DELAY_MS = 50;

/**
 * What the app knows about who is online: ONLINE or OFFLINE per person, filled in by batched
 * lookups and kept fresh by live updates. A person nobody has asked about reads as unknown
 * (undefined), so no dot is drawn until the answer arrives.
 */
export function createPresenceStore({
  fetchPresence = api.getPresence,
  delayMs = BATCH_DELAY_MS,
} = {}) {
  const statuses = new Map();
  const listeners = new Set();
  const asked = new Set();
  let waiting = new Set();
  let timer;

  const notify = () => listeners.forEach((listener) => listener());

  const setMany = (entries) => {
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
    const ids = [...waiting];
    waiting = new Set();

    for (let start = 0; start < ids.length; start += MAX_PER_REQUEST) {
      const chunk = ids.slice(start, start + MAX_PER_REQUEST);
      try {
        // eslint-disable-next-line no-await-in-loop -- a few chunks at most, in order
        setMany(await fetchPresence(chunk));
      } catch {
        // Asked again the next time a row needs it.
        chunk.forEach((id) => asked.delete(id));
      }
    }
  };

  const schedule = () => {
    if (timer === undefined) timer = setTimeout(flush, delayMs);
  };

  return {
    get: (userId) => statuses.get(userId),
    set: (userId, status) => setMany({ [userId]: status }),
    setMany,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Asks the server about this person once, together with whoever else asks in the same moment. */
    request(userId) {
      if (!userId || asked.has(userId)) return;
      asked.add(userId);
      waiting.add(userId);
      schedule();
    },
    /** After a reconnect updates may have been missed: ask about everyone known again. */
    refreshAll() {
      statuses.forEach((_, userId) => waiting.add(userId));
      if (waiting.size > 0) schedule();
    },
    /** Forgets everyone, e.g. when signing out. */
    clear() {
      clearTimeout(timer);
      timer = undefined;
      waiting = new Set();
      asked.clear();
      if (statuses.size > 0) {
        statuses.clear();
        notify();
      }
    },
  };
}

export const presenceStore = createPresenceStore();
