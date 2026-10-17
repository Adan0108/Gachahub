import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemberAvatar } from "../components/chat/GroupSettingsModal";

const presence = vi.hoisted(() => ({ of: vi.fn() }));
vi.mock("../hooks/presence/usePresenceOf", () => ({ usePresenceOf: presence.of }));

const member = (extra = {}) => ({
  userId: "bo",
  state: "ACTIVE",
  user: { name: "Bo", image: null },
  ...extra,
});

describe("group member presence", () => {
  beforeEach(() => {
    presence.of.mockReset();
    presence.of.mockReturnValue("ONLINE");
  });

  it("shows a green dot for an online member", () => {
    render(<MemberAvatar participant={member()} />);

    expect(presence.of).toHaveBeenCalledWith("bo");
    expect(screen.getByLabelText("Online")).toBeInTheDocument();
  });

  it("shows no dot for an offline member", () => {
    presence.of.mockReturnValue("OFFLINE");

    render(<MemberAvatar participant={member()} />);

    expect(screen.queryByLabelText("Online")).not.toBeInTheDocument();
  });

  it("does not look up yourself, or someone who has not accepted the invite", () => {
    render(<MemberAvatar isSelf participant={member()} />);
    render(<MemberAvatar participant={member({ state: "PENDING" })} />);

    expect(presence.of).toHaveBeenNthCalledWith(1, undefined);
    expect(presence.of).toHaveBeenNthCalledWith(2, undefined);
  });
});
