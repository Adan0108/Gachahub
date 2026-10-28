import { SEND_ARRIVAL_MARGIN_MS, SEND_LIMIT, SEND_WINDOW_MS } from "../../chat/messageLimits";

type Clock = { now: () => number; sleep: (ms: number) => Promise<void> };

const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * When sends may go out. Sends of one conversation go one at a time, in the order they were
 * typed: sent all at once they queue on the server's conversation lock, and the last ones time
 * out here while the server still stores them. And every send, in any conversation, waits for a
 * slot under the server's per-user limit, so a backlog behind a slow send never arrives in a rush.
 */
export class SendScheduler {
  private readonly queues = new Map<string, Promise<unknown>>();
  // When recent sends reached the server, or are booked to.
  private readonly slots: number[] = [];

  constructor(
    private readonly limit = SEND_LIMIT,
    private readonly windowMs = SEND_WINDOW_MS + SEND_ARRIVAL_MARGIN_MS,
    private readonly clock: Clock = realClock,
  ) {}

  /** Runs `task` after every earlier task with the same key has settled. */
  oneAtATime<T>(key: string, task: () => Promise<T>): Promise<T> {
    const run = (this.queues.get(key) ?? Promise.resolve()).then(task, task);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(key, settled);
    void settled.then(() => {
      if (this.queues.get(key) === settled) this.queues.delete(key);
    });
    return run;
  }

  /** Waits until one more send stays within the server's limit. */
  async waitForSlot(): Promise<void> {
    const now = this.clock.now();
    while (this.slots.length > 0 && now - this.slots[0]! >= this.windowMs) this.slots.shift();
    const slot = Math.max(now, (this.slots.at(-this.limit) ?? -Infinity) + this.windowMs);
    this.slots.push(slot);
    if (slot > now) await this.clock.sleep(slot - now);
  }
}

export const sendScheduler = new SendScheduler();
