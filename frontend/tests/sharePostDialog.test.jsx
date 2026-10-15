import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SharePostDialog } from "../components/SharePostDialog";
import { SHARE_RESULT } from "../hooks/chat/usePostShare";

const mocks = vi.hoisted(() => ({
  sendTo: vi.fn(),
  canSend: true,
  conversations: { data: [], isLoading: false },
  pickPeople: null,
}));

vi.mock("../hooks/chat/usePostShare", async (importOriginal) => ({
  ...(await importOriginal()),
  usePostShare: () => ({ canSend: mocks.canSend, deviceError: undefined, sendTo: mocks.sendTo }),
}));
vi.mock("../hooks/chat/useChatConversations", () => ({
  useChatConversations: () => mocks.conversations,
}));
vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "me", name: "Me" } }),
}));
vi.mock("../components/chat/UserPicker", () => ({
  UserPicker: ({ onChange }) => {
    mocks.pickPeople = onChange;
    return <div data-testid="user-picker" />;
  },
}));

const person = (id, name, state = "ACTIVE") => ({
  userId: id,
  state,
  user: { id, name, image: null },
});
const dm = (id, name, otherState = "ACTIVE") => ({
  id,
  type: "DIRECT",
  participants: [person("me", "Me"), person(`${id}-u`, name, otherState)],
});

const chatBox = (name) => screen.getByRole("checkbox", { name: new RegExp(name) });

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
      data: [dm("c1", "Bob"), dm("c2", "Cara", "PENDING")],
      isLoading: false,
    };
    mocks.sendTo.mockResolvedValue({ status: SHARE_RESULT.SENT });
  });

  it("lists your chats and shows why one cannot be picked", () => {
    setup();

    expect(chatBox("Bob")).toBeEnabled();
    expect(chatBox("Cara")).toBeDisabled();
    expect(screen.getByText("Waiting for them to accept")).toBeInTheDocument();
  });

  it("narrows the list as you type", () => {
    setup();

    fireEvent.change(screen.getByLabelText("Search your chats"), { target: { value: "bo" } });

    expect(chatBox("Bob")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Cara/ })).not.toBeInTheDocument();
  });

  it("cannot send until a chat or person is picked", () => {
    setup();

    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();

    fireEvent.click(chatBox("Bob"));

    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  it("cannot send while this device's encryption is not ready", () => {
    mocks.canSend = false;
    setup();
    fireEvent.click(chatBox("Bob"));

    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByText("Setting up encryption...")).toBeInTheDocument();
  });

  it("sends the post with the note to each picked chat and shows the results", async () => {
    setup();
    fireEvent.click(chatBox("Bob"));
    fireEvent.change(screen.getByLabelText("Add a note"), { target: { value: "look at this" } });

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Bob"));
    expect(mocks.sendTo).toHaveBeenCalledWith(expect.objectContaining({ key: "chat:c1" }), {
      postId: "cm123abc",
      caption: "look at this",
    });
    expect(screen.getByRole("status")).toHaveTextContent("Sent");
  });

  it("sends to a person you have not messaged yet", async () => {
    setup();
    mocks.pickPeople([{ id: "dan", name: "Dan" }]);

    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(mocks.sendTo).toHaveBeenCalledWith(
        expect.objectContaining({ key: "person:dan", person: { id: "dan", name: "Dan" } }),
        expect.any(Object),
      ),
    );
  });

  it("offers a retry for only the sends that failed", async () => {
    mocks.sendTo.mockResolvedValueOnce({ status: SHARE_RESULT.FAILED, reason: "Network down" });
    setup();
    fireEvent.click(chatBox("Bob"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText("Network down")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(mocks.sendTo).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Sent"));
  });

  it("tells you a message request went out instead", async () => {
    mocks.sendTo.mockResolvedValue({ status: SHARE_RESULT.REQUESTED });
    setup();
    mocks.pickPeople([{ id: "dan", name: "Dan" }]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(screen.getByText(/Share again once they accept/)).toBeInTheDocument(),
    );
  });

  it("copies the link and closes", () => {
    const { onCopyLink, onClose } = setup();

    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onCopyLink).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("offers the device's own share sheet only when there is one", () => {
    setup();
    expect(screen.queryByRole("button", { name: /more/i })).not.toBeInTheDocument();
  });
});
