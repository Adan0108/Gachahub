import { describe, expect, it } from "vitest";
import { describeNotification } from "../lib/notifications/describeNotification";

const base = { actor: { name: "Rover" }, entityId: "e1" };

describe("describeNotification", () => {
  it("names the actor and links a liked post to it", () => {
    expect(describeNotification({ ...base, type: "POST_LIKED", entityType: "POST" })).toEqual({
      actor: "Rover",
      title: "Rover",
      image: null,
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
      describeNotification({
        ...base,
        type: "COMMENT_REPLIED",
        entityType: "COMMENT",
        postId: null,
      }).href,
    ).toBeNull();
  });

  it("links a mention to wherever it happened", () => {
    expect(describeNotification({ ...base, type: "USER_MENTIONED", entityType: "POST" }).href).toBe(
      "/post/e1",
    );
    expect(
      describeNotification({ ...base, type: "USER_MENTIONED", entityType: "COMMENT", postId: "p9" })
        .href,
    ).toBe("/post/p9");
    expect(
      describeNotification({ ...base, type: "USER_MENTIONED", entityType: "MESSAGE" }).href,
    ).toBe("/chat");
  });

  it.each([
    ["MESSAGE_RECEIVED", "MESSAGE", "sent you a message"],
    ["MESSAGE_REPLIED", "MESSAGE", "replied to your message"],
    ["GROUP_ADDED", "CONVERSATION", "added you to a group"],
    ["GROUP_INVITE_PENDING", "CONVERSATION", "invited you to a group"],
  ])("sends %s to the chat page", (type, entityType, action) => {
    expect(describeNotification({ ...base, type, entityType })).toMatchObject({
      action,
      href: "/chat",
    });
  });

  it("has no link for a follow", () => {
    expect(
      describeNotification({ ...base, type: "USER_FOLLOWED", entityType: "USER" }),
    ).toMatchObject({
      action: "followed you",
      href: null,
    });
  });

  it("falls back to Someone when the actor is gone, and to a generic line for a new type", () => {
    expect(
      describeNotification({ type: "POST_LIKED", entityType: "POST", entityId: "e1", actor: null })
        .actor,
    ).toBe("Someone");
    expect(describeNotification({ ...base, type: "SOMETHING_NEW", entityType: "POST" })).toEqual({
      actor: "Rover",
      title: "Rover",
      image: null,
      action: "sent you a notification",
      href: null,
    });
  });

  describe("mentions in community chat", () => {
    const mention = (extra = {}) => ({
      ...base,
      type: "USER_MENTIONED",
      entityType: "COMMUNITY_MESSAGE",
      entityId: "cm 1",
      community: { slug: "wuthering-waves", name: "Wuthering Waves" },
      ...extra,
    });

    it("says where you were mentioned", () => {
      expect(describeNotification(mention()).action).toBe("mentioned you in Wuthering Waves");
    });

    it("opens that community's chat on the message", () => {
      expect(describeNotification(mention()).href).toBe(
        "/community/wuthering-waves?tab=Chat&message=cm%201",
      );
    });

    it("has nowhere to go, and says only that you were mentioned, when the community is gone", () => {
      const lost = describeNotification(mention({ community: null }));

      expect(lost.href).toBeNull();
      expect(lost.action).toBe("mentioned you");
    });
  });

  describe("chat notifications", () => {
    it.each([
      ["MESSAGE_RECEIVED", "MESSAGE"],
      ["MESSAGE_REPLIED", "MESSAGE"],
      ["USER_MENTIONED", "MESSAGE"],
      ["GROUP_ADDED", "CONVERSATION"],
      ["GROUP_INVITE_PENDING", "CONVERSATION"],
    ])("opens the conversation for %s", (type, entityType) => {
      const notification = { ...base, type, entityType, conversationId: "c1" };

      expect(describeNotification(notification).href).toBe("/chat?c=c1");
    });

    it("just opens the chat when the conversation is not known", () => {
      expect(
        describeNotification({ ...base, type: "MESSAGE_RECEIVED", entityType: "MESSAGE", conversationId: null }).href,
      ).toBe("/chat");
    });

    it("escapes the id in the link", () => {
      expect(
        describeNotification({ ...base, type: "MESSAGE_RECEIVED", entityType: "MESSAGE", conversationId: "a&b" }).href,
      ).toBe("/chat?c=a%26b");
    });
  });

  describe("stacked chat notifications", () => {
    const stack = (extra: any) => ({ ...base, type: "MESSAGE_RECEIVED", entityType: "MESSAGE", ...extra });
    const dm = { type: "DIRECT", title: null };
    const squad = { type: "GROUP", title: "Squad", photoUrl: "https://cdn/squad.png" };

    it("counts the messages of a direct chat", () => {
      expect(describeNotification(stack({ count: 1, conversation: dm })).action).toBe("sent you a message");
      expect(describeNotification(stack({ count: 5, conversation: dm })).action).toBe("sent you 5 messages");
    });

    it("names the sender and counts the messages in a group", () => {
      expect(describeNotification(stack({ count: 1, conversation: squad })).action).toBe("Rover sent a message in Squad");
      expect(describeNotification(stack({ count: 12, conversation: squad })).action).toBe("Rover sent 12 messages in Squad");
    });

    it("falls back to the old wording for a row with no count or conversation", () => {
      expect(describeNotification(stack({})).action).toBe("sent you a message");
    });

    it("heads a group row with the group and its photo, and a direct row with the sender", () => {
      const group = describeNotification(stack({ count: 1, conversation: squad }));
      expect(group).toMatchObject({ title: "Squad", image: "https://cdn/squad.png" });

      const direct = describeNotification(stack({ count: 1, conversation: dm, actor: { name: "Rover", image: "https://cdn/r.png" } }));
      expect(direct).toMatchObject({ title: "Rover", image: "https://cdn/r.png" });
    });

    it("has no photo for a group without one", () => {
      expect(describeNotification(stack({ conversation: { type: "GROUP", title: "Squad", photoUrl: null } })).image).toBeNull();
    });

    it("puts the group in the title for replies, additions and invites", () => {
      const row = (type: any, entityType: any) => ({ ...base, type, entityType, conversation: squad });

      expect(describeNotification(row("MESSAGE_REPLIED", "MESSAGE"))).toMatchObject({
        title: "Squad",
        action: "Rover replied to your message in Squad",
      });
      expect(describeNotification(row("GROUP_ADDED", "CONVERSATION")).action).toBe("Rover added you to Squad");
      expect(describeNotification(row("GROUP_INVITE_PENDING", "CONVERSATION")).action).toBe("Rover invited you to Squad");
    });

    it("calls a group with no name Unnamed group", () => {
      const untitled = { type: "GROUP", title: null, photoUrl: null };

      expect(describeNotification({ ...base, type: "GROUP_ADDED", entityType: "CONVERSATION", conversation: untitled })).toMatchObject({
        title: "Unnamed group",
        action: "Rover added you to Unnamed group",
      });
    });
  });
});
