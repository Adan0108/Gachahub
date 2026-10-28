import { describe, expect, it } from "vitest";
import { matchMembers, mentionedIds, typingMention } from "../lib/mentions";

describe("typingMention", () => {
  it("sees an @ with nothing after it yet", () => {
    expect(typingMention("hi @", 4)).toEqual({ start: 3, end: 4, query: "" });
  });

  it("gives the part typed so far, and where the @ started", () => {
    expect(typingMention("hi @bob", 7)).toEqual({ start: 3, end: 7, query: "bob" });
  });

  it("looks only at what is before the caret", () => {
    expect(typingMention("hi @bobby", 6)).toEqual({ start: 3, end: 6, query: "bo" });
  });

  it("is null when the caret has left the word", () => {
    expect(typingMention("hi @bob there", 13)).toBeNull();
    expect(typingMention("hi @bob ", 8)).toBeNull();
  });

  it("is null for an email and for a plain word", () => {
    expect(typingMention("mail me at bob@gma", 18)).toBeNull();
    expect(typingMention("no mention", 10)).toBeNull();
  });

  it("works at the start of the text", () => {
    expect(typingMention("@al", 3)).toEqual({ start: 0, end: 3, query: "al" });
  });
});

describe("chat mentions", () => {
  const members = [
    { id: "u-bob", name: "Bob Stone", username: "bob" },
    { id: "u-amy", name: "Amy", username: "amy_r" },
  ];

  it("suggests members by the start of their handle or name", () => {
    expect(matchMembers(members, "b").map((m) => m.id)).toEqual(["u-bob"]);
    expect(matchMembers(members, "AM").map((m) => m.id)).toEqual(["u-amy"]);
    expect(matchMembers(members, "")).toHaveLength(2);
  });

  it("turns @handles of members into their ids once each, ignoring strangers and emails", () => {
    expect(mentionedIds("@bob hi @Bob, @amy_r and @nobody, mail bob@x.com", members)).toEqual(["u-bob", "u-amy"]);
    expect(mentionedIds("no mentions", members)).toEqual([]);
  });
});
