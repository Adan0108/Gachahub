import { describe, expect, it } from "vitest";
import { describeNotification } from "../lib/notifications/describeNotification";

const base = { actor: { name: "Rover" }, entityId: "e1" };

describe("describeNotification", () => {
  it("names the actor and links a liked post to it", () => {
    expect(describeNotification({ ...base, type: "POST_LIKED", entityType: "POST" })).toEqual({
      actor: "Rover",
      action: "liked your post",
      href: "/post/e1",
    });
  });

  it("links a comment or reply to the post the backend resolved", () => {
    const comment = { ...base, type: "POST_COMMENTED", entityType: "COMMENT", postId: "p9" };

    expect(describeNotification(comment).href).toBe("/post/p9");
    expect(describeNotification({ ...comment, type: "COMMENT_REPLIED" }).href).toBe("/post/p9");
  });

  it("has no link for a comment whose post could not be resolved", () => {
    expect(
      describeNotification({ ...base, type: "COMMENT_REPLIED", entityType: "COMMENT", postId: null }).href,
    ).toBeNull();
  });

  it("links a mention to wherever it happened", () => {
    expect(describeNotification({ ...base, type: "USER_MENTIONED", entityType: "POST" }).href).toBe("/post/e1");
    expect(
      describeNotification({ ...base, type: "USER_MENTIONED", entityType: "COMMENT", postId: "p9" }).href,
    ).toBe("/post/p9");
    expect(describeNotification({ ...base, type: "USER_MENTIONED", entityType: "MESSAGE" }).href).toBe("/chat");
  });

  it.each([
    ["MESSAGE_RECEIVED", "MESSAGE", "sent you a message"],
    ["MESSAGE_REPLIED", "MESSAGE", "replied to your message"],
    ["GROUP_ADDED", "CONVERSATION", "added you to a group"],
    ["GROUP_INVITE_PENDING", "CONVERSATION", "invited you to a group"],
  ])("sends %s to the chat page", (type, entityType, action) => {
    expect(describeNotification({ ...base, type, entityType })).toMatchObject({ action, href: "/chat" });
  });

  it("has no link for a follow", () => {
    expect(describeNotification({ ...base, type: "USER_FOLLOWED", entityType: "USER" })).toMatchObject({
      action: "followed you",
      href: null,
    });
  });

  it("falls back to Someone when the actor is gone, and to a generic line for a new type", () => {
    expect(describeNotification({ type: "POST_LIKED", entityType: "POST", entityId: "e1", actor: null }).actor).toBe(
      "Someone",
    );
    expect(describeNotification({ ...base, type: "SOMETHING_NEW", entityType: "POST" })).toEqual({
      actor: "Rover",
      action: "sent you a notification",
      href: null,
    });
  });
});
