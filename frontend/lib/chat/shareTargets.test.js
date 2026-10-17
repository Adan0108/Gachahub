import { describe, expect, it } from "vitest";
import { directConversationWith, shareStatus, shareTargets } from "./shareTargets";

const person = (id, name, state = "ACTIVE") => ({
  userId: id,
  state,
  user: { id, name, image: null },
});
const dm = (id, other, otherState = "ACTIVE", myState = "ACTIVE") => ({
  id,
  type: "DIRECT",
  participants: [person("me", "Me", myState), person(other, other, otherState)],
});
const group = (id, title, members) => ({
  id,
  type: "GROUP",
  title,
  participants: [person("me", "Me"), ...members],
});

describe("shareStatus", () => {
  it("is fine for a chat where someone else is active", () => {
    expect(shareStatus(dm("c1", "bob"), "me")).toEqual({ ok: true, reason: null });
  });

  it("waits for a direct chat the other person has not accepted", () => {
    expect(shareStatus(dm("c1", "bob", "PENDING"), "me")).toEqual({
      ok: false,
      reason: "Waiting for them to accept",
    });
  });

  it("says nobody has joined an otherwise empty group", () => {
    const empty = group("g1", "Raid", [person("ann", "Ann", "PENDING")]);

    expect(shareStatus(empty, "me")).toEqual({ ok: false, reason: "Nobody has joined yet" });
  });

  it("refuses a chat you are no longer active in", () => {
    expect(shareStatus(dm("c1", "bob", "ACTIVE", "REMOVED"), "me").ok).toBe(false);
  });
});

describe("shareTargets", () => {
  const conversations = [
    dm("c1", "Bob"),
    group("g1", "Raid night", [person("ann", "Ann")]),
    dm("c2", "Cara", "PENDING"),
  ];

  it("lists every chat with its name and whether it can be sent into", () => {
    const targets = shareTargets(conversations, "me");

    expect(targets.map((target) => [target.name, target.ok])).toEqual([
      ["Bob", true],
      ["Raid night", true],
      ["Cara", false],
    ]);
  });

  it("narrows by what was typed, ignoring case", () => {
    const targets = shareTargets(conversations, "me", "  RAID ");

    expect(targets.map((target) => target.name)).toEqual(["Raid night"]);
  });

  it("copes with no conversations yet", () => {
    expect(shareTargets(undefined, "me")).toEqual([]);
  });
});

describe("directConversationWith", () => {
  it("finds the direct chat with a person in the first list that has it", () => {
    const inbox = [dm("c1", "bob")];
    const archived = [dm("c9", "cara")];

    expect(directConversationWith([inbox, archived], "cara")?.id).toBe("c9");
  });

  it("ignores groups they happen to be in", () => {
    const inbox = [group("g1", "Raid", [person("bob", "Bob")])];

    expect(directConversationWith([inbox], "bob")).toBeUndefined();
  });

  it("copes with a list that has not loaded", () => {
    expect(directConversationWith([undefined, []], "bob")).toBeUndefined();
  });
});
