import { describe, expect, it } from "vitest";
import { typingMention } from "../lib/mentions";

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
