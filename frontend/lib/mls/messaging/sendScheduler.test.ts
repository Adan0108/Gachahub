import { describe, expect, it } from "vitest";
import { SendScheduler } from "./sendScheduler";

/** A clock that only moves when told to; sleeping waits until then. */
function fakeClock() {
  let now = 0;
  const sleepers: Array<{ until: number; wake: () => void }> = [];
  return {
    now: () => now,
    sleep: (ms: number) => new Promise<void>((wake) => sleepers.push({ until: now + ms, wake })),
    advance(ms: number) {
      now += ms;
      for (const sleeper of sleepers.filter((item) => item.until <= now)) {
        sleepers.splice(sleepers.indexOf(sleeper), 1);
        sleeper.wake();
      }
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

describe("SendScheduler", () => {
  // Spammed sends all at once queued on the server's lock; the last ones timed out here though the server stored them.
  it("runs one task per key at a time, in order, and keeps going after a failure", async () => {
    const scheduler = new SendScheduler();
    const order: string[] = [];
    let finishFirst = () => {};

    const first = scheduler.oneAtATime("c1", async () => {
      await new Promise<void>((resolve) => (finishFirst = resolve));
      order.push("a");
      throw new Error("a failed");
    });
    const second = scheduler.oneAtATime("c1", async () => {
      order.push("b");
    });
    const other = scheduler.oneAtATime("c2", async () => {
      order.push("other");
    });
    await other;
    expect(order).toEqual(["other"]);

    finishFirst();
    await expect(first).rejects.toThrow("a failed");
    await second;
    expect(order).toEqual(["other", "a", "b"]);
  });

  // Typed a second apart, sends could still reach the server in a rush behind a slow one and be refused.
  it("lets the limit through at once, then holds the next until the oldest leaves the window", async () => {
    const clock = fakeClock();
    const scheduler = new SendScheduler(3, 1_000, clock);
    let started = 0;
    const sends = Array.from({ length: 4 }, () =>
      scheduler.waitForSlot().then(() => {
        started += 1;
      }),
    );

    await flush();
    expect(started).toBe(3);

    clock.advance(999);
    await flush();
    expect(started).toBe(3);

    clock.advance(1);
    await Promise.all(sends);
    expect(started).toBe(4);
  });

  it("does not hold sends slower than the limit", async () => {
    const clock = fakeClock();
    const scheduler = new SendScheduler(3, 1_000, clock);

    for (let i = 0; i < 6; i += 1) {
      await scheduler.waitForSlot();
      clock.advance(400);
    }
  });
});
