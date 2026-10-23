import { describe, expect, it } from "vitest";
import {
  buildThreadItems,
  eventsForDisplay,
  membershipEventText,
  messageDividerLabel,
  messageFullTimestamp,
  newestUnreadableFromOthers,
  readableNeighbors,
  replyOriginalSenderLabel,
  threadItemKey,
  wasLikelySentDuringAbsence,
  withOptimisticDelete,
} from "./chatThread";
import type { MembershipEvent } from "../mls/sync/membershipEvents";

type Status = "ok" | "unavailable" | "pending";
const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
const message = (id: string, minute: number, contentType?: string, senderId = "alice") => ({
  id,
  senderId,
  createdAt: at(minute),
  contentType,
  status: undefined as string | undefined,
});
const decrypted = (statuses: Record<string, Status>) =>
  Object.fromEntries(Object.entries(statuses).map(([id, status]) => [id, { status }]));
const event = (id: string, minute: number): MembershipEvent => ({
  id,
  conversationId: "c",
  epoch: 1,
  kind: "joined",
  userId: "bob",
  at: Date.parse(at(minute)),
});
const shape = (items: ReturnType<typeof buildThreadItems>) =>
  items.map((item) =>
    item.kind === "message" ? item.message.id : item.kind === "event" ? item.event.id : item.kind,
  );

describe("eventsForDisplay", () => {
  type Round = { invitedAt?: string; joinedAt?: string };
  const group = (participants: Array<{ userId: string; rounds: Round[] }>) => ({
    type: "GROUP",
    participants: participants.map(({ userId, rounds }) => ({
      userId,
      rounds: rounds.map((round) => ({
        invitedAt: round.invitedAt ?? null,
        joinedAt: round.joinedAt ?? null,
      })),
    })),
  });
  const verified = (
    id: string,
    userId: string,
    minute: number,
    kind: "joined" | "left" = "joined",
  ) => ({
    ...event(id, minute),
    userId,
    kind,
  });
  const kinds = (events: ReturnType<typeof eventsForDisplay>) =>
    events.map((item) => `${item.kind}:${item.userId}@${new Date(item.at).getUTCMinutes()}`);

  // A invites B and C at minute 0; B accepts at minute 2; A and B talk; C answers at minute 10.
  it("says B and C are invited, then that B joined when B accepted", () => {
    const shown = eventsForDisplay(
      [verified("b-in", "bob", 0), verified("c-in", "cy", 0)],
      group([
        { userId: "bob", rounds: [{ invitedAt: at(0), joinedAt: at(2) }] },
        { userId: "cy", rounds: [{ invitedAt: at(0) }] },
      ]),
    );

    expect(kinds(shown)).toEqual(["invited:bob@0", "invited:cy@0", "accepted:bob@2"]);
  });

  it("says C joined when C accepts later, at that time", () => {
    const shown = eventsForDisplay(
      [verified("c-in", "cy", 0)],
      group([{ userId: "cy", rounds: [{ invitedAt: at(0), joinedAt: at(10) }] }]),
    );

    expect(kinds(shown)).toEqual(["invited:cy@0", "accepted:cy@10"]);
  });

  it('says nothing when C declines: no "left", no "declined"', () => {
    const shown = eventsForDisplay(
      [verified("c-in", "cy", 0), verified("c-out", "cy", 10, "left")],
      group([{ userId: "cy", rounds: [{ invitedAt: at(0) }] }]),
    );

    expect(kinds(shown)).toEqual(["invited:cy@0"]);
  });

  it('keeps "joined" for someone added directly, and "left" for a member who leaves', () => {
    const shown = eventsForDisplay(
      [verified("d-in", "dee", 0), verified("d-out", "dee", 5, "left")],
      group([{ userId: "dee", rounds: [{ joinedAt: at(0) }] }]),
    );

    expect(kinds(shown)).toEqual(["joined:dee@0", "left:dee@5"]);
  });

  // Invited at 0, accepted at 2, left at 5, invited again at 20: every line stays.
  it("keeps the earlier rounds when someone is invited again", () => {
    const shown = eventsForDisplay(
      [
        verified("in-1", "bob", 0),
        verified("out-1", "bob", 5, "left"),
        verified("in-2", "bob", 20),
      ],
      group([
        { userId: "bob", rounds: [{ invitedAt: at(0), joinedAt: at(2) }, { invitedAt: at(20) }] },
      ]),
    );

    expect(kinds(shown)).toEqual([
      "invited:bob@0",
      "left:bob@5",
      "invited:bob@20",
      "accepted:bob@2",
    ]);
  });

  it("still hides a declined first invite after a second one", () => {
    const shown = eventsForDisplay(
      [verified("in-1", "cy", 0), verified("out-1", "cy", 3, "left"), verified("in-2", "cy", 20)],
      group([
        { userId: "cy", rounds: [{ invitedAt: at(0) }, { invitedAt: at(20), joinedAt: at(21) }] },
      ]),
    );

    expect(kinds(shown)).toEqual(["invited:cy@0", "invited:cy@20", "accepted:cy@21"]);
  });

  it("drops the new-device notices older builds stored", () => {
    const stored = { ...event("old", 1), kind: "device-added" } as unknown as MembershipEvent;

    expect(eventsForDisplay([stored], group([]))).toEqual([]);
  });

  it("shows nothing in a DM", () => {
    expect(eventsForDisplay([event("e1", 0)], { type: "DIRECT", participants: [] })).toEqual([]);
  });
});

describe("buildThreadItems", () => {
  describe("a message still being decrypted", () => {
    const build = (messages: ReturnType<typeof message>[], states: Record<string, Status>) =>
      buildThreadItems({
        messages,
        decrypted: decrypted(states),
        events: [],
        collapseLeading: false,
      });

    it("leaves no divider behind, since nothing is drawn for it", () => {
      const items = build([message("a", 0), message("b", 120), message("c", 240)], {
        a: "ok",
        b: "pending",
      });

      // b is not drawn yet, and c has no decrypt state either, so only a is on screen
      expect(shape(items)).toEqual(["timestamp", "a"]);
    });

    it("does not break the gap logic for the messages around it", () => {
      const items = build([message("a", 0), message("b", 10), message("c", 20)], {
        a: "ok",
        b: "pending",
        c: "ok",
      });

      // a and c are 20 minutes apart: no divider, same as if b were not there
      expect(shape(items)).toEqual(["timestamp", "a", "c"]);
    });

    it("gets its divider once it can be drawn", () => {
      const messages = [message("a", 0), message("b", 120)];

      expect(shape(build(messages, { a: "ok", b: "pending" }))).toEqual(["timestamp", "a"]);
      expect(shape(build(messages, { a: "ok", b: "ok" }))).toEqual([
        "timestamp",
        "a",
        "timestamp",
        "b",
      ]);
    });

    it("still counts an unsent message, a start marker and an unavailable message as drawn", () => {
      const items = build(
        [{ ...message("a", 0), status: "DELETED" }, message("b", 120, "SYSTEM"), message("c", 240)],
        { c: "unavailable" },
      );

      expect(shape(items)).toEqual(["timestamp", "a", "timestamp", "c"]);
    });
  });

  it("collapses leading undecryptable messages into one banner", () => {
    const items = buildThreadItems({
      messages: [message("a", 1), message("b", 2), message("c", 3)],
      decrypted: decrypted({ a: "unavailable", b: "unavailable", c: "ok" }),
      events: [],
      collapseLeading: true,
    });
    expect(shape(items)).toEqual(["history-banner", "timestamp", "c"]);
  });

  it("keeps an undecryptable message that follows a readable one", () => {
    const items = buildThreadItems({
      messages: [message("a", 1), message("b", 2), message("c", 3)],
      decrypted: decrypted({ a: "ok", b: "unavailable", c: "ok" }),
      events: [],
      collapseLeading: true,
    });
    expect(shape(items)).toEqual(["timestamp", "a", "b", "c"]);
  });

  it("steps over the conversation-started row, and leaves out pending messages, while collapsing", () => {
    const items = buildThreadItems({
      messages: [message("s", 0, "SYSTEM"), message("a", 1), message("p", 2), message("c", 3)],
      decrypted: decrypted({ a: "unavailable", p: "pending", c: "ok" }),
      events: [],
      collapseLeading: true,
    });
    expect(shape(items)).toEqual(["history-banner", "timestamp", "c"]);
  });

  it("shows no banner when nothing is unreadable, and keeps everything when told not to collapse", () => {
    const messages = [message("a", 1), message("b", 2)];
    const allOk = buildThreadItems({
      messages,
      decrypted: decrypted({ a: "ok", b: "ok" }),
      events: [],
      collapseLeading: true,
    });
    const uncollapsed = buildThreadItems({
      messages,
      decrypted: decrypted({ a: "unavailable", b: "ok" }),
      events: [],
      collapseLeading: false,
    });
    expect(shape(allOk)).toEqual(["timestamp", "a", "b"]);
    expect(shape(uncollapsed)).toEqual(["timestamp", "a", "b"]);
  });

  it("places events by time among messages, before a message with the same time", () => {
    const items = buildThreadItems({
      messages: [message("a", 1), message("b", 5), message("c", 9)],
      decrypted: decrypted({ a: "ok", b: "ok", c: "ok" }),
      events: [event("late", 20), event("tie", 5), event("mid", 3)],
      collapseLeading: true,
    });
    expect(shape(items)).toEqual(["timestamp", "a", "mid", "tie", "b", "c", "late"]);
  });

  // They used to pile up at the bottom, under the loading spinner.
  it("shows no membership events while the thread is loading or still decrypting", () => {
    const events = [event("joined", 3)];
    const loading = buildThreadItems({
      messages: [],
      decrypted: {},
      events,
      collapseLeading: true,
      loaded: false,
    });
    const decrypting = buildThreadItems({
      messages: [message("a", 1), message("b", 5)],
      decrypted: decrypted({ a: "ok", b: "pending" }),
      events,
      collapseLeading: true,
    });

    expect(loading).toEqual([]);
    expect(shape(decrypting)).toEqual(["timestamp", "a"]);
  });

  it("leaves out events from before the oldest loaded message while older history is unloaded", () => {
    const items = buildThreadItems({
      messages: [message("a", 5), message("b", 9)],
      decrypted: decrypted({ a: "ok", b: "ok" }),
      events: [event("long-ago", 1), event("between", 7)],
      collapseLeading: true,
      hasOlderHistory: true,
    });

    expect(shape(items)).toEqual(["timestamp", "a", "between", "b"]);
  });

  it("records each message index in the original list", () => {
    const items = buildThreadItems({
      messages: [message("a", 1), message("b", 2)],
      decrypted: decrypted({ a: "unavailable", b: "ok" }),
      events: [],
      collapseLeading: true,
    });
    expect(items[2]).toMatchObject({ kind: "message", index: 1 });
  });

  it("always puts a timestamp above the first visible message", () => {
    const items = buildThreadItems({
      messages: [message("a", 1)],
      decrypted: decrypted({ a: "ok" }),
      events: [],
      collapseLeading: true,
    });
    expect(items[0]).toMatchObject({ kind: "timestamp", at: Date.parse(at(1)) });
  });

  it('drops "conversation started" as soon as someone has written', () => {
    const items = buildThreadItems({
      messages: [message("s", 0, "SYSTEM"), message("a", 1)],
      decrypted: decrypted({ s: "ok", a: "ok" }),
      events: [],
      collapseLeading: true,
    });
    expect(shape(items)).toEqual(["timestamp", "a"]);
  });

  it('shows "conversation started" alone, with no time, until somebody writes', () => {
    const items = buildThreadItems({
      messages: [message("s", 0, "SYSTEM")],
      decrypted: decrypted({}),
      events: [],
      collapseLeading: true,
    });
    expect(shape(items)).toEqual(["s"]);
  });

  it("gives a message a full divider once the gap since the last one passes 45 minutes", () => {
    const items = buildThreadItems({
      messages: [message("a", 0), message("b", 45)],
      decrypted: decrypted({ a: "ok", b: "ok" }),
      events: [],
      collapseLeading: true,
    });
    expect(shape(items)).toEqual(["timestamp", "a", "timestamp", "b"]);
    expect(items.find((i) => i.kind === "message" && i.message.id === "b")).toMatchObject({
      gapBefore: false,
    });
  });

  it("flags only extra spacing, no divider, for a 25-45 minute gap", () => {
    const items = buildThreadItems({
      messages: [message("a", 0), message("b", 25)],
      decrypted: decrypted({ a: "ok", b: "ok" }),
      events: [],
      collapseLeading: true,
    });
    expect(shape(items)).toEqual(["timestamp", "a", "b"]);
    expect(items[2]).toMatchObject({ kind: "message", message: { id: "b" }, gapBefore: true });
  });

  it("groups messages under 25 minutes apart with no divider and no extra spacing", () => {
    const items = buildThreadItems({
      messages: [message("a", 0), message("b", 24)],
      decrypted: decrypted({ a: "ok", b: "ok" }),
      events: [],
      collapseLeading: true,
    });
    expect(shape(items)).toEqual(["timestamp", "a", "b"]);
    expect(items[2]).toMatchObject({ kind: "message", message: { id: "b" }, gapBefore: false });
  });

  it("stacks two close messages from the same sender, first marked as having a follower", () => {
    const items = buildThreadItems({
      messages: [message("a", 0), message("b", 1)],
      decrypted: decrypted({ a: "ok", b: "ok" }),
      events: [],
      collapseLeading: true,
    });
    expect(items[1]).toMatchObject({
      message: { id: "a" },
      groupedWithPrevious: false,
      groupedWithNext: true,
    });
    expect(items[2]).toMatchObject({
      message: { id: "b" },
      groupedWithPrevious: true,
      groupedWithNext: false,
    });
  });

  it("does not stack messages from two different senders", () => {
    const items = buildThreadItems({
      messages: [message("a", 0, undefined, "alice"), message("b", 1, undefined, "bob")],
      decrypted: decrypted({ a: "ok", b: "ok" }),
      events: [],
      collapseLeading: true,
    });
    expect(items[2]).toMatchObject({ message: { id: "b" }, groupedWithPrevious: false });
  });

  it("does not stack same-sender messages separated by a membership event", () => {
    const items = buildThreadItems({
      messages: [message("a", 0), message("b", 1)],
      decrypted: decrypted({ a: "ok", b: "ok" }),
      events: [event("e", 1)],
      collapseLeading: true,
    });
    expect(shape(items)).toEqual(["timestamp", "a", "e", "b"]);
    expect(items[3]).toMatchObject({ message: { id: "b" }, groupedWithPrevious: false });
  });

  it("does not stack same-sender messages once the gap earns extra spacing", () => {
    const items = buildThreadItems({
      messages: [message("a", 0), message("b", 25)],
      decrypted: decrypted({ a: "ok", b: "ok" }),
      events: [],
      collapseLeading: true,
    });
    expect(items[2]).toMatchObject({
      message: { id: "b" },
      gapBefore: true,
      groupedWithPrevious: false,
    });
  });
});

describe("membershipEventText", () => {
  const base = event("e", 1);

  it("words each kind, falling back for an unknown name", () => {
    expect(membershipEventText(base, "Bob", false)).toBe("Bob joined the group");
    expect(membershipEventText({ ...base, kind: "invited" }, "Bob", false)).toBe(
      "Bob was invited to the group",
    );
    expect(membershipEventText({ ...base, kind: "invited" }, undefined, true)).toBe(
      "You were invited to the group",
    );
    expect(membershipEventText({ ...base, kind: "accepted" }, "Bob", false)).toBe(
      "Bob joined the group",
    );
    expect(membershipEventText({ ...base, kind: "accepted" }, undefined, true)).toBe(
      "You joined the group",
    );
    expect(membershipEventText({ ...base, kind: "left" }, undefined, false)).toBe(
      "Deleted user left or was removed from the group",
    );
  });
});

describe("threadItemKey", () => {
  it("keys each row kind by its own id", () => {
    expect(threadItemKey({ kind: "history-banner" })).toBe("history-banner");
    expect(
      threadItemKey({
        kind: "message",
        message: message("m1", 0),
        index: 0,
        gapBefore: false,
        groupedWithPrevious: false,
        groupedWithNext: false,
      }),
    ).toBe("m1");
    expect(threadItemKey({ kind: "timestamp", at: 123 })).toBe("timestamp-123");
  });
});

// Local-time constructors, not UTC ISO strings: getHours()/toLocaleDateString() read the
// system's local clock, so a fixed UTC instant would shift with the machine's timezone.
describe("messageDividerLabel", () => {
  const now = new Date(2026, 8, 28, 15, 0).getTime();

  it("shows only the time for a message sent today", () => {
    expect(messageDividerLabel(new Date(2026, 8, 28, 9, 5).getTime(), now, "en-US")).toBe("09:05");
  });

  it("shows the weekday and time within the past 6 days", () => {
    expect(messageDividerLabel(new Date(2026, 8, 23, 21, 13).getTime(), now, "en-US")).toBe(
      "Wed 21:13",
    );
  });

  it("shows the full date and time once older than a week", () => {
    expect(messageDividerLabel(new Date(2026, 8, 16, 14, 40).getTime(), now, "en-US")).toBe(
      "16 Sep 2026, 14:40",
    );
  });
});

describe("messageFullTimestamp", () => {
  it("always spells out the full date", () => {
    expect(messageFullTimestamp(new Date(2026, 8, 16, 14, 40).getTime(), "en-US")).toBe(
      "16 September 2026, 14:40",
    );
  });
});

describe("withOptimisticDelete", () => {
  it("marks only the matching message deleted, leaving others untouched", () => {
    const messages = [
      { id: "a", status: "SENT" },
      { id: "b", status: "SENT" },
    ];
    const result = withOptimisticDelete(messages, "a");
    expect(result).toEqual([
      { id: "a", status: "DELETED" },
      { id: "b", status: "SENT" },
    ]);
    expect(result[1]).toBe(messages[1]);
  });
});

describe("replyOriginalSenderLabel", () => {
  it('says "You" when someone else replies to a message the viewer wrote', () => {
    expect(replyOriginalSenderLabel("bob", "me", "me", "Me")).toBe("You");
  });

  it('says "yourself" when the viewer replies to their own earlier message', () => {
    expect(replyOriginalSenderLabel("me", "me", "me", "Me")).toBe("yourself");
  });

  it('says "themself" when someone else replies to their own earlier message', () => {
    expect(replyOriginalSenderLabel("bob", "bob", "me", "Bob")).toBe("themself");
  });

  it("names the original sender when neither the replier nor the viewer wrote it", () => {
    expect(replyOriginalSenderLabel("bob", "carol", "me", "Carol")).toBe("Carol");
  });

  it("falls back to a plain label once the sender or name is unknown", () => {
    expect(replyOriginalSenderLabel("bob", undefined, "me", undefined)).toBe("a message");
    expect(replyOriginalSenderLabel("bob", "carol", "me", undefined)).toBe("a message");
  });
});

describe("readableNeighbors / wasLikelySentDuringAbsence", () => {
  const messages = [message("a", 0), message("b", 1), message("c", 2)];

  it("is true only when readable messages sit on both sides", () => {
    const withBothSidesOk = readableNeighbors(
      messages,
      decrypted({ a: "ok", b: "unavailable", c: "ok" }),
    );
    expect(wasLikelySentDuringAbsence(withBothSidesOk, 1)).toBe(true);

    const withNeitherSideOk = readableNeighbors(
      messages,
      decrypted({ a: "unavailable", b: "unavailable", c: "ok" }),
    );
    expect(wasLikelySentDuringAbsence(withNeitherSideOk, 1)).toBe(false);
  });

  it("is false at either end of the thread, with nothing on one side", () => {
    const neighbors = readableNeighbors(
      messages,
      decrypted({ a: "ok", b: "ok", c: "unavailable" }),
    );
    expect(wasLikelySentDuringAbsence(neighbors, 0)).toBe(false);
    expect(wasLikelySentDuringAbsence(neighbors, 2)).toBe(false);
  });
});

describe("newestUnreadableFromOthers", () => {
  const others = (id: string, minute: number, contentType?: string) =>
    message(id, minute, contentType, "bob");

  it("is the newest message from someone else this device could not decrypt", () => {
    const messages = [others("a", 1), others("b", 2), message("mine", 3, undefined, "alice")];

    expect(
      newestUnreadableFromOthers(
        messages,
        decrypted({ a: "unavailable", b: "unavailable" }),
        "alice",
      ),
    ).toBe("b");
  });

  it("counts the conversation-start marker, which is never decrypted", () => {
    const messages = [others("start", 1, "SYSTEM"), message("mine", 2, undefined, "alice")];

    expect(newestUnreadableFromOthers(messages, decrypted({}), "alice")).toBe("start");
  });

  it("ignores messages that were read, are still being decrypted, or are the viewers own", () => {
    const messages = [
      others("read", 1),
      others("later", 2),
      message("mine", 3, "SYSTEM", "alice"),
      message("mine-gone", 4, undefined, "alice"),
    ];

    expect(
      newestUnreadableFromOthers(
        messages,
        decrypted({ read: "ok", later: "pending", "mine-gone": "unavailable" }),
        "alice",
      ),
    ).toBeUndefined();
  });
});
