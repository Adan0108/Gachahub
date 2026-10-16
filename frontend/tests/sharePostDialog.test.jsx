import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SharePostDialog } from "../components/SharePostDialog";
import { SHARE_RESULT } from "../hooks/chat/usePostShare";

const mocks = vi.hoisted(() => ({
  sendTo: vi.fn(),
  canSend: true,
  conversations: { data: [], isLoading: false },
  search: { items: [], isActive: false, isLoading: false, error: undefined, retry: vi.fn() },
}));

vi.mock("../hooks/chat/usePostShare", async (importOriginal) => ({
  ...(await importOriginal()),
  usePostShare: () => ({ canSend: mocks.canSend, deviceError: undefined, sendTo: mocks.sendTo }),
}));
vi.mock("../hooks/chat/useChatConversations", () => ({
  useChatConversations: () => mocks.conversations,
}));
vi.mock("../hooks/chat/useUserSearch", () => ({
  USER_SEARCH_MIN_CHARS: 2,
  useUserSearch: (query) => ({
    ...mocks.search,
    isActive: query.trim().length >= 2 && mocks.search.isActive,
  }),
}));
vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "me", name: "Me" } }),
}));

const person = (id, name, state = "ACTIVE") => ({
  userId: id,
  state,
  user: { id, name, image: null },
});
const dm = (id, peerId, name, otherState = "ACTIVE") => ({
  id,
  type: "DIRECT",
  participants: [person("me", "Me"), person(peerId, name, otherState)],
});

const tile = (name) => screen.getByRole("checkbox", { name: new RegExp(name) });

function setup(props = {}) {
  const handlers = { onClose: vi.fn(), onCopyLink: vi.fn(), onNativeShare: undefined };
  render(<SharePostDialog postId="cm123abc" {...handlers} {...props} />);
  return handlers;
}

describe("SharePostDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canSend = true;
    mocks.conversations = {
      data: [dm("c1", "bob", "Bob"), dm("c2", "cara", "Cara", "PENDING")],
      isLoading: false,
    };
    mocks.search = {
      items: [],
      isActive: false,
      isLoading: false,
      error: undefined,
      retry: vi.fn(),
    };
    mocks.sendTo.mockResolvedValue({ status: SHARE_RESULT.SENT });
  });

  it("shows your chats as a grid of names to tick, and why one cannot be picked", () => {
    setup();

    expect(tile("Bob")).toBeEnabled();
    expect(tile("Cara")).toBeDisabled();
    expect(screen.getByText("Waiting for them to accept")).toBeInTheDocument();
  });

  it("narrows the chats as you type", () => {
    setup();

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "bo" } });

    expect(tile("Bob")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Cara/ })).not.toBeInTheDocument();
  });

  it("holds its place with placeholders while the chats load", () => {
    mocks.conversations = { data: undefined, isLoading: true };

    const { container } = render(<SharePostDialog onClose={vi.fn()} postId="cm123abc" />);

    expect(container.ownerDocument.querySelectorAll(".share-post-skeleton").length).toBeGreaterThan(
      0,
    );
  });

  it("shows no message bar or send button until someone is picked", () => {
    setup();

    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Add a note")).not.toBeInTheDocument();

    fireEvent.click(tile("Bob"));

    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
    expect(screen.getByPlaceholderText("Write a message...")).toBeInTheDocument();
  });

  it("marks a picked chat as checked, and unchecks it on a second tap", () => {
    setup();

    fireEvent.click(tile("Bob"));
    expect(tile("Bob")).toHaveAttribute("aria-checked", "true");

    fireEvent.click(tile("Bob"));
    expect(tile("Bob")).toHaveAttribute("aria-checked", "false");
  });

  it("counts how many it is sending to", () => {
    mocks.conversations = {
      data: [dm("c1", "bob", "Bob"), dm("c3", "dan", "Dan")],
      isLoading: false,
    };
    setup();

    fireEvent.click(tile("Bob"));
    fireEvent.click(tile("Dan"));

    expect(screen.getByRole("button", { name: "Send to 2" })).toBeInTheDocument();
  });

  it("cannot send while this device's encryption is not ready", () => {
    mocks.canSend = false;
    setup();
    fireEvent.click(tile("Bob"));

    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByText("Setting up encryption...")).toBeInTheDocument();
  });

  it("sends the post with the message to each picked chat and shows who got it", async () => {
    setup();
    fireEvent.click(tile("Bob"));
    fireEvent.change(screen.getByLabelText("Add a note"), { target: { value: "look at this" } });

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Bob"));
    expect(mocks.sendTo).toHaveBeenCalledWith(expect.objectContaining({ key: "chat:c1" }), {
      postId: "cm123abc",
      caption: "look at this",
    });
    expect(screen.getByRole("status")).toHaveTextContent("Sent");
  });

  it("offers people found by search who you have not messaged, and sends to them", async () => {
    mocks.search = {
      ...mocks.search,
      isActive: true,
      items: [{ id: "dan", name: "Dan Newman", image: null }],
    };
    setup();

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "dan" } });
    fireEvent.click(tile("Dan Newman"));
    expect(screen.getByText(/message request first/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(mocks.sendTo).toHaveBeenCalledWith(
        expect.objectContaining({ key: "person:dan", person: { id: "dan", name: "Dan Newman" } }),
        expect.any(Object),
      ),
    );
  });

  it("shows a person you already chat with as that chat instead of a duplicate", () => {
    mocks.search = {
      ...mocks.search,
      isActive: true,
      items: [{ id: "bob", name: "Bob", image: null }],
    };
    setup();

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "bob" } });

    expect(screen.getAllByRole("checkbox", { name: /Bob/ })).toHaveLength(1);
  });

  it("keeps a picked person on screen after the search text is cleared", () => {
    mocks.search = {
      ...mocks.search,
      isActive: true,
      items: [{ id: "dan", name: "Dan Newman", image: null }],
    };
    setup();
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "dan" } });
    fireEvent.click(tile("Dan Newman"));

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "" } });

    expect(tile("Dan Newman")).toHaveAttribute("aria-checked", "true");
  });

  it("asks for at least two characters before searching for people", () => {
    setup();

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "d" } });

    expect(screen.getByText(/at least 2 characters/i)).toBeInTheDocument();
  });

  it("says when nobody matches", () => {
    mocks.conversations = { data: [], isLoading: false };
    setup();

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "zzzz" } });

    expect(screen.getByText(/No one found/)).toBeInTheDocument();
  });

  it("offers a retry for only the sends that failed", async () => {
    mocks.sendTo.mockResolvedValueOnce({ status: SHARE_RESULT.FAILED, reason: "Network down" });
    setup();
    fireEvent.click(tile("Bob"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText("Network down")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(mocks.sendTo).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Sent"));
  });

  it("tells you a message request went out instead", async () => {
    mocks.sendTo.mockResolvedValue({ status: SHARE_RESULT.REQUESTED });
    mocks.search = {
      ...mocks.search,
      isActive: true,
      items: [{ id: "dan", name: "Dan Newman", image: null }],
    };
    setup();
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "dan" } });
    fireEvent.click(tile("Dan Newman"));

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(screen.getByText(/Share again once they accept/)).toBeInTheDocument(),
    );
  });

  it("copies the link, says so, and closes from the X", async () => {
    const { onCopyLink, onClose } = setup();

    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));
    await waitFor(() => expect(screen.getByText("Link copied")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onCopyLink).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("offers the device's own share sheet only when there is one", () => {
    const { rerender } = render(<SharePostDialog onClose={vi.fn()} postId="cm123abc" />);
    expect(screen.queryByRole("button", { name: /more/i })).not.toBeInTheDocument();

    rerender(<SharePostDialog onClose={vi.fn()} onNativeShare={vi.fn()} postId="cm123abc" />);
    expect(screen.getByRole("button", { name: /more/i })).toBeInTheDocument();
  });
});
