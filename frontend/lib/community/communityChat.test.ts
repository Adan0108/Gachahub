import { describe, expect, it } from "vitest";
import {
  quoteText,
  buildRows,
  canEditCommunityMessage,
  dayLabel,
  messagesOf,
  olderPageParam,
  patchMessage,
  upsertMessage,
  type CommunityMessage,
  type CommunityPagesData,
} from "./communityChat";

const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute).toISOString();

const message = (id: string, extra: Partial<CommunityMessage> = {}): CommunityMessage => ({
  id,
  channelId: "c1",
  content: `text ${id}`,
  deleted: false,
  blocked: false,
  createdAt: at(16, 10),
  editedAt: null,
  author: { id: "ann", name: "Ann", image: null, badge: null },
  replyTo: null,
  media: [],
  reactions: [],
  ...extra,
});

const pages = (...items: CommunityMessage[][]): CommunityPagesData => ({
  pages: items.map((page, index) => ({ items: page, hasMore: index < items.length - 1 })),
  pageParams: items.map(() => undefined),
});

describe("messagesOf", () => {
  it("lists every loaded message oldest first, with the newest page first in the data", () => {
    const data = pages([message("m3"), message("m4")], [message("m1"), message("m2")]);

    expect(messagesOf(data).map((item) => item.id)).toEqual(["m1", "m2", "m3", "m4"]);
  });

  it("is empty before anything is loaded", () => {
    expect(messagesOf(undefined)).toEqual([]);
  });
});

describe("olderPageParam", () => {
  it("is the oldest message of the page when older ones remain", () => {
    expect(olderPageParam({ items: [message("m5"), message("m6")], hasMore: true })).toBe("m5");
  });

  it("is nothing at the start of the room", () => {
    expect(olderPageParam({ items: [message("m1")], hasMore: false })).toBeUndefined();
  });
});

describe("upsertMessage", () => {
  it("adds a new message to the end of the newest page", () => {
    const data = pages([message("m2", { createdAt: at(16, 11) })], [message("m1")]);

    const result = upsertMessage(data, message("m3", { createdAt: at(16, 12) }));

    expect(messagesOf(result).map((item) => item.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("keeps time order when a message arrives out of order", () => {
    const data = pages([
      message("m1", { createdAt: at(16, 10) }),
      message("m3", { createdAt: at(16, 12) }),
    ]);

    const result = upsertMessage(data, message("m2", { createdAt: at(16, 11) }));

    expect(messagesOf(result).map((item) => item.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("replaces a message that is already there instead of adding it twice", () => {
    const data = pages([message("m1")]);

    const result = upsertMessage(data, message("m1", { content: "edited" }));

    expect(messagesOf(result)).toHaveLength(1);
    expect(messagesOf(result)[0]!.content).toBe("edited");
  });

  it("replaces a message found in an older page", () => {
    const data = pages([message("m2")], [message("m1")]);

    const result = upsertMessage(data, message("m1", { content: "edited" }));

    expect(messagesOf(result).map((item) => item.content)).toEqual(["edited", "text m2"]);
  });

  it("leaves a list that has not loaded alone", () => {
    expect(upsertMessage(undefined, message("m1"))).toBeUndefined();
  });

  it("does not change the data it was given", () => {
    const data = pages([message("m1")]);
    const before = JSON.stringify(data);

    upsertMessage(data, message("m2", { createdAt: at(16, 12) }));

    expect(JSON.stringify(data)).toBe(before);
  });
});

describe("patchMessage", () => {
  it("changes only the message asked for", () => {
    const data = pages([message("m1"), message("m2")]);

    const result = patchMessage(data, "m2", (item) => ({ ...item, content: "changed" }));

    expect(messagesOf(result).map((item) => item.content)).toEqual(["text m1", "changed"]);
  });
});

describe("canEditCommunityMessage", () => {
  const now = Date.parse(at(16, 10, 10));

  it("allows the author within 15 minutes", () => {
    expect(canEditCommunityMessage(message("m1"), "ann", now)).toBe(true);
  });

  it.each([
    ["someone else", message("m1"), "bob", now],
    ["a signed-out viewer", message("m1"), undefined, now],
    ["a removed message", message("m1", { deleted: true, content: null }), "ann", now],
    ["a message older than 15 minutes", message("m1"), "ann", Date.parse(at(16, 10, 16))],
  ])("refuses %s", (_name, item, userId, time) => {
    expect(canEditCommunityMessage(item, userId, time)).toBe(false);
  });

  it("refuses a message whose author is gone", () => {
    expect(canEditCommunityMessage(message("m1", { author: null }), "ann", now)).toBe(false);
  });
});

describe("dayLabel", () => {
  const now = new Date(2026, 9, 16, 15);

  it("names today and yesterday and dates the rest", () => {
    expect(dayLabel(new Date(2026, 9, 16, 9), now, "en")).toBe("Today");
    expect(dayLabel(new Date(2026, 9, 15, 23), now, "en")).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 9, 1, 9), now, "en")).toBe("Oct 1, 2026");
  });
});

describe("buildRows", () => {
  const now = new Date(2026, 9, 16, 15);
  const rows = (messages: CommunityMessage[]) => buildRows(messages, { now, locale: "en" });
  const shape = (list: ReturnType<typeof rows>) =>
    list.map((row) =>
      row.kind === "day" ? `day:${row.label}` : `${row.message.id}${row.showHeader ? "+" : ""}`,
    );

  it("starts with a day divider and a header", () => {
    expect(shape(rows([message("m1")]))).toEqual(["day:Today", "m1+"]);
  });

  it("gives one person's quick run of messages a single header", () => {
    const list = rows([
      message("m1", { createdAt: at(16, 10, 0) }),
      message("m2", { createdAt: at(16, 10, 2) }),
      message("m3", { createdAt: at(16, 10, 4) }),
    ]);

    expect(shape(list)).toEqual(["day:Today", "m1+", "m2", "m3"]);
  });

  it("starts a new header when someone else speaks", () => {
    const list = rows([
      message("m1"),
      message("m2", { author: { id: "bob", name: "Bob", image: null, badge: null } }),
    ]);

    expect(shape(list)).toEqual(["day:Today", "m1+", "m2+"]);
  });

  it("starts a new header after a gap of more than five minutes", () => {
    const list = rows([
      message("m1", { createdAt: at(16, 10, 0) }),
      message("m2", { createdAt: at(16, 10, 6) }),
    ]);

    expect(shape(list)).toEqual(["day:Today", "m1+", "m2+"]);
  });

  it("starts a new header for a reply, so the quote has a name above it", () => {
    const reply = {
      id: "m0",
      content: "hi",
      deleted: false,
      blocked: false,
      hasMedia: false,
      authorName: "Bob",
    };

    expect(shape(rows([message("m1"), message("m2", { replyTo: reply })]))).toEqual([
      "day:Today",
      "m1+",
      "m2+",
    ]);
  });

  it("does not run a removed message into its neighbours", () => {
    const list = rows([
      message("m1"),
      message("m2", { deleted: true, content: null }),
      message("m3"),
    ]);

    expect(shape(list)).toEqual(["day:Today", "m1+", "m2+", "m3+"]);
  });

  it("does not run a message you blocked into its neighbours", () => {
    const list = rows([
      message("m1"),
      message("m2", { blocked: true, content: null, author: null }),
      message("m3"),
    ]);

    expect(shape(list)).toEqual(["day:Today", "m1+", "m2+", "m3+"]);
  });

  it("puts a divider where the day changes and restarts the header", () => {
    const list = rows([
      message("m1", { createdAt: at(15, 23, 58) }),
      message("m2", { createdAt: at(16, 0, 1) }),
    ]);

    expect(shape(list)).toEqual(["day:Yesterday", "m1+", "day:Today", "m2+"]);
  });

  it("is empty for an empty room", () => {
    expect(rows([])).toEqual([]);
  });
});

describe("quoteText", () => {
  it("quotes the text of a message", () => {
    expect(quoteText({ content: "hi", hasMedia: true })).toBe("hi");
  });

  it("says Photo for a message that is pictures alone", () => {
    expect(quoteText({ content: "", hasMedia: true })).toBe("Photo");
  });

  it("quotes nothing for a message with neither", () => {
    expect(quoteText({ content: null, hasMedia: false })).toBe("");
  });
});
