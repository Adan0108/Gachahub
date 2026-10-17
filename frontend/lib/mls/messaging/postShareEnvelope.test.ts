import { describe, expect, it } from "vitest";
import { envelopeView, isMediaOnlyView } from "../media/attachmentView";
import { searchableText } from "../../chat/searchableMessages";
import {
  buildPostShareEnvelope,
  isPostId,
  isPostShareEnvelope,
  postPath,
} from "./postShareEnvelope";

describe("buildPostShareEnvelope", () => {
  it("carries only the post id when there is no note", () => {
    expect(buildPostShareEnvelope("cm123abc")).toEqual({
      v: 1,
      type: "post-share",
      postId: "cm123abc",
    });
  });

  it("adds a trimmed note", () => {
    expect(buildPostShareEnvelope("cm123abc", "  look at this  ")).toMatchObject({
      body: "look at this",
    });
  });

  it("leaves a blank note out", () => {
    expect(buildPostShareEnvelope("cm123abc", "   ")).not.toHaveProperty("body");
  });

  it("cuts a very long note to what a receiver will accept", () => {
    const envelope = buildPostShareEnvelope("cm123abc", "x".repeat(5000));

    expect(isPostShareEnvelope(envelope)).toBe(true);
    expect(envelope.body!.length).toBe(1000);
  });
});

describe("isPostShareEnvelope", () => {
  const valid = { v: 1, type: "post-share", postId: "cm123abc" };

  it("accepts a plain share and one with a note", () => {
    expect(isPostShareEnvelope(valid)).toBe(true);
    expect(isPostShareEnvelope({ ...valid, body: "hi" })).toBe(true);
  });

  it.each([
    ["another type", { ...valid, type: "text" }],
    ["another version", { ...valid, v: 2 }],
    ["no post id", { v: 1, type: "post-share" }],
    ["an empty post id", { ...valid, postId: "" }],
    ["a post id that is not text", { ...valid, postId: 42 }],
    ["a post id with a path in it", { ...valid, postId: "../admin" }],
    ["a post id with a query in it", { ...valid, postId: "a?b=c" }],
    ["a post id that is far too long", { ...valid, postId: "a".repeat(65) }],
    ["a note that is not text", { ...valid, body: { a: 1 } }],
    ["a note that is far too long", { ...valid, body: "x".repeat(1001) }],
    ["an array", []],
    ["nothing", null],
  ])("refuses %s", (_name, value) => {
    expect(isPostShareEnvelope(value)).toBe(false);
  });
});

describe("isPostId", () => {
  it("accepts the shapes post ids really have", () => {
    expect(isPostId("cmv8zh2rz000yzku5cqk5dyig")).toBe(true);
    expect(isPostId("post_1-A")).toBe(true);
  });

  it("refuses anything that could change the address it ends up in", () => {
    expect(isPostId("a/b")).toBe(false);
    expect(isPostId("a b")).toBe(false);
    expect(isPostId("a#b")).toBe(false);
    expect(isPostId("")).toBe(false);
  });
});

describe("postPath", () => {
  it("points at the post page", () => {
    expect(postPath("cm123abc")).toBe("/post/cm123abc");
  });
});

describe("a post share as a thread view", () => {
  it("reads as a post with its note", () => {
    expect(envelopeView(buildPostShareEnvelope("cm123abc", "hi"))).toEqual({
      kind: "post",
      caption: "hi",
      postId: "cm123abc",
    });
  });

  it("has no chrome of its own when there is no note", () => {
    expect(isMediaOnlyView(envelopeView(buildPostShareEnvelope("cm123abc")))).toBe(true);
    expect(isMediaOnlyView(envelopeView(buildPostShareEnvelope("cm123abc", "hi")))).toBe(false);
  });

  it("is searched by its note only", () => {
    expect(searchableText(buildPostShareEnvelope("cm123abc", "cute cat"))).toBe("cute cat");
    expect(searchableText(buildPostShareEnvelope("cm123abc"))).toBe("");
  });

  it("is not shown for a malformed one", () => {
    expect(envelopeView({ v: 1, type: "post-share", postId: "../x" })).toBeNull();
  });
});
