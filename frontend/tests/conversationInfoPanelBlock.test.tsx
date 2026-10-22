import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { ConversationInfoPanel } from "../components/chat/ConversationInfoPanel";

vi.mock("../hooks/chat/useMessageSearchIndex", () => ({
  useMessageSearchIndex: () => ({
    index: { search: () => ({ terms: [], hits: [] }) },
    status: "ready",
    version: 0,
    indexed: 0,
    total: 0,
  }),
}));
vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "me" }, isAuthenticated: true }),
}));
vi.mock("../lib/api", () => ({
  api: {},
  fallbackCategories: vi.fn(() => []),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(() => ({ items: [] })),
  fallbackPosts: vi.fn(() => []),
}));

const person = (id: string, name: string) => ({ userId: id, state: "ACTIVE", user: { id, name } });
const direct = {
  id: "c1",
  type: "DIRECT",
  participants: [person("me", "Me"), person("peer", "Mado")],
};
const group = {
  id: "g1",
  type: "GROUP",
  title: "Squad",
  participants: [person("me", "Me"), person("a", "Ann")],
};

function renderPanel({
  conversation = direct,
  isBlockPending = false,
  isUnblockPending = false,
  onBlock = vi.fn(),
  onUnblock = vi.fn(),
} = {}) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ConversationInfoPanel
        canVerify={false}
        verifyLabel="Verify"
        onVerify={vi.fn()}
        onGroupChanged={vi.fn()}
        onLeftGroup={vi.fn()}
        safety={{}}
        onVerifyMember={vi.fn()}
        conversation={conversation}
        displayName={conversation.type === "GROUP" ? "Squad" : "Mado"}
        encryptionStatus="Encrypted"
        fileAttachments={[]}
        isBlockPending={isBlockPending}
        isGroup={conversation.type === "GROUP"}
        isOpen
        isUnblockPending={isUnblockPending}
        onBlock={onBlock}
        onUnblock={onUnblock}
        onClose={vi.fn()}
        onOpenAttachment={vi.fn()}
        search={{
          messagesById: new Map(),
          hiddenMessageIds: new Set(),
          history: {
            hasMoreHistory: false,
            isLoadingOlder: false,
            isWaitingOnRateLimit: false,
            historyError: undefined,
            loadOlderMessages: vi.fn(),
            retryHistory: vi.fn(),
            rateLimitSecondsLeft: 0,
          },
          onJump: vi.fn(),
        }}
        userId="me"
        visualAttachments={[]}
      />
    </QueryClientProvider>,
  );
  return { onBlock, onUnblock };
}

const blockRow = () => screen.getByRole("button", { name: "Block" });

describe("ConversationInfoPanel blocking", () => {
  it("asks first instead of blocking straight away", () => {
    const { onBlock } = renderPanel();

    fireEvent.click(blockRow());

    expect(screen.getByRole("dialog", { name: "Block Mado?" })).toBeInTheDocument();
    expect(onBlock).not.toHaveBeenCalled();
  });

  it("says what blocking does", () => {
    renderPanel();

    fireEvent.click(blockRow());

    expect(within(screen.getByRole("dialog")).getByText(/send them messages/)).toBeInTheDocument();
  });

  it("starts on Cancel, so a stray Enter does not block anyone", () => {
    renderPanel();

    fireEvent.click(blockRow());

    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("does nothing when cancelled", () => {
    const { onBlock } = renderPanel();
    fireEvent.click(blockRow());

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onBlock).not.toHaveBeenCalled();
  });

  it("does nothing on Escape", () => {
    const { onBlock } = renderPanel();
    fireEvent.click(blockRow());

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onBlock).not.toHaveBeenCalled();
  });

  it("does nothing when the backdrop is clicked", () => {
    const { onBlock } = renderPanel();
    fireEvent.click(blockRow());

    fireEvent.click(screen.getByRole("dialog").parentElement!);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onBlock).not.toHaveBeenCalled();
  });

  it("blocks once when confirmed, and closes the dialog", () => {
    const { onBlock } = renderPanel();
    fireEvent.click(blockRow());

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Block" }));

    expect(onBlock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks again next time, rather than remembering the last answer", () => {
    const { onBlock } = renderPanel();
    fireEvent.click(blockRow());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(blockRow());

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onBlock).not.toHaveBeenCalled();
  });

  it("cannot be opened while a block is already going through", () => {
    renderPanel({ isBlockPending: true });

    expect(blockRow()).toBeDisabled();
  });

  describe("a person you blocked", () => {
    const blockedDirect = {
      ...direct,
      participants: [person("me", "Me"), { ...person("peer", "Mado"), isBlockedByMe: true }],
    };

    it("offers Unblock instead of Block, with no question asked", () => {
      const { onUnblock } = renderPanel({ conversation: blockedDirect });

      expect(screen.queryByRole("button", { name: "Block" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Unblock" }));

      expect(onUnblock).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("cannot be unblocked twice while it is going through", () => {
      renderPanel({ conversation: blockedDirect, isUnblockPending: true });

      expect(screen.getByRole("button", { name: "Unblock" })).toBeDisabled();
    });
  });

  it("has no Block on a group, where it would cut you off from everyone", () => {
    renderPanel({ conversation: group });

    expect(screen.queryByRole("button", { name: "Block" })).not.toBeInTheDocument();
  });

  describe("layout", () => {
    it("has no Profile button, since there is no profile page to open", () => {
      renderPanel();

      expect(screen.queryByRole("button", { name: "Profile" })).not.toBeInTheDocument();
    });

    it("folds the media and files rows away and opens them again", () => {
      renderPanel();
      const toggle = screen.getByRole("button", { name: "Media and files" });

      expect(screen.getByRole("button", { name: /^Files/ })).toBeInTheDocument();
      fireEvent.click(toggle);
      expect(screen.queryByRole("button", { name: /^Files/ })).not.toBeInTheDocument();
      fireEvent.click(toggle);
      expect(screen.getByRole("button", { name: /^Files/ })).toBeInTheDocument();
    });

    it("puts Media where Profile was for someone who cannot add people", () => {
      renderPanel({ conversation: group });

      expect(screen.getAllByRole("button", { name: /^Media/ }).length).toBeGreaterThan(0);
      expect(screen.queryByRole("button", { name: "Add people" })).not.toBeInTheDocument();
    });

    it("puts Add people there for a group owner, and it opens the members and the picker", () => {
      const owned = { ...group, participants: [{ ...person("me", "Me"), role: "OWNER" }, person("a", "Ann")] };
      renderPanel({ conversation: owned });
      fireEvent.click(screen.getByRole("button", { name: /Members/ }));
      expect(screen.queryByText("Ann")).not.toBeInTheDocument();

      fireEvent.click(screen.getByText("Add people", { selector: "button" }));

      expect(screen.getByText("Ann")).toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "Add people" })).toBeInTheDocument();
    });
  });

  it("sits on top of the whole page, not inside the panel that opened it", () => {
    renderPanel();

    fireEvent.click(blockRow());

    expect(screen.getByRole("dialog").closest("aside")).toBeNull();
    expect(document.body).toContainElement(screen.getByRole("dialog").parentElement!);
  });
});
