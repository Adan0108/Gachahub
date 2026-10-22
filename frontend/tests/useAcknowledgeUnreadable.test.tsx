import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAcknowledgeUnreadable } from "../hooks/chat/useAcknowledgeUnreadable";

const setup = (initial?: any) => {
  const onRead = vi.fn();
  const hook = renderHook((props) => useAcknowledgeUnreadable({ onRead, ...props }), {
    initialProps: { conversationId: "c1", unreadCount: 4, messageId: "m1", ...initial },
  });
  return { onRead, ...hook };
};

describe("useAcknowledgeUnreadable", () => {
  it("reports the unreadable message as read while the conversation still shows unread", () => {
    const { onRead } = setup();

    expect(onRead).toHaveBeenCalledTimes(1);
    expect(onRead).toHaveBeenCalledWith("m1");
  });

  it("does nothing when nothing is unread, or there is no such message", () => {
    expect(setup({ unreadCount: 0 }).onRead).not.toHaveBeenCalled();
    expect(setup({ unreadCount: undefined }).onRead).not.toHaveBeenCalled();
    expect(setup({ messageId: undefined }).onRead).not.toHaveBeenCalled();
  });

  it("asks once per message, even if the count stays up while the server answers", () => {
    const { onRead, rerender } = setup();

    rerender({ conversationId: "c1", unreadCount: 4, messageId: "m1" });
    rerender({ conversationId: "c1", unreadCount: 3, messageId: "m1" });

    expect(onRead).toHaveBeenCalledTimes(1);
  });

  it("asks again for a newer unreadable message, and for another conversation", () => {
    const { onRead, rerender } = setup();

    rerender({ conversationId: "c1", unreadCount: 2, messageId: "m2" });
    rerender({ conversationId: "c2", unreadCount: 1, messageId: "m2" });

    expect(onRead.mock.calls.map(([id]) => id)).toEqual(["m1", "m2", "m2"]);
  });
});
