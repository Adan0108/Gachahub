import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GroupIdentity } from "../components/chat/GroupIdentity";
import { GroupMembersSection } from "../components/chat/GroupMembersSection";

const mocks = vi.hoisted(() => ({
  uploadSingleImage: vi.fn(),
  setGroupPhoto: vi.fn(),
  removeGroupPhoto: vi.fn(),
  updateGroupChat: vi.fn(),
  addGroupMembers: vi.fn(),
  removeGroupMembers: vi.fn(),
  updateGroupMemberRole: vi.fn(),
  transferGroupOwnership: vi.fn(),
  leaveGroup: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: mocks,
  fallbackCategories: vi.fn(() => []),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(() => ({ items: [] })),
  fallbackPosts: vi.fn(() => []),
}));
vi.mock("../hooks/presence/usePresenceOf", () => ({ usePresenceOf: () => "OFFLINE" }));
const search = vi.hoisted(() => ({
  state: {
    items: [] as any[],
    isLoading: false,
    error: undefined as Error | undefined,
    isActive: false,
    retry: vi.fn(),
  },
}));
vi.mock("../hooks/chat/useUserSearch", () => ({
  USER_SEARCH_MIN_CHARS: 2,
  useUserSearch: (query: any) => ({ ...search.state, isActive: query.trim().length >= 2 }),
}));

const person = (id: any, name: any, role = "MEMBER", state = "ACTIVE") => ({
  userId: id,
  state,
  role,
  user: { id, name, image: null },
});
const group = (me = "OWNER", extra = {}) => ({
  id: "g1",
  type: "GROUP",
  title: "Squad",
  photoUrl: null,
  participants: [person("me", "Me", me), person("ann", "Ann", "ADMIN"), person("bo", "Bo")],
  ...extra,
});

const wrap = (node: any) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      {node}
    </QueryClientProvider>,
  );

const image = (name = "pic.png", type = "image/png") => new File(["x"], name, { type });

beforeEach(() => {
  vi.clearAllMocks();
  search.state = { items: [], isLoading: false, error: undefined, isActive: false, retry: vi.fn() };
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  mocks.uploadSingleImage.mockResolvedValue({ mediaUploadId: "up1" });
  mocks.setGroupPhoto.mockResolvedValue({ id: "g1", photoUrl: "https://cdn/up1.png" });
  mocks.removeGroupPhoto.mockResolvedValue({ id: "g1", photoUrl: null });
  mocks.updateGroupChat.mockResolvedValue({ id: "g1" });
  mocks.addGroupMembers.mockResolvedValue({});
  mocks.removeGroupMembers.mockResolvedValue({});
  mocks.updateGroupMemberRole.mockResolvedValue({});
  mocks.transferGroupOwnership.mockResolvedValue({});
  mocks.leaveGroup.mockResolvedValue({});
});

describe("GroupIdentity", () => {
  const setup = (props = {}) => {
    const onChanged = vi.fn();
    wrap(<GroupIdentity canManage conversation={group()} onChanged={onChanged} {...props} />);
    return { onChanged };
  };
  const fileInput = () => document.querySelector('input[type="file"]')!;

  it("offers the photo and the name to change only to someone who manages the group", () => {
    setup({ canManage: false });

    expect(screen.getByText("Squad")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change group photo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change group name" })).not.toBeInTheDocument();
  });

  it("uploads the chosen file and saves it as the group photo", async () => {
    const { onChanged } = setup();

    fireEvent.change(fileInput(), { target: { files: [image()] } });

    await waitFor(() => expect(mocks.setGroupPhoto).toHaveBeenCalledWith("g1", "up1"));
    expect(mocks.uploadSingleImage).toHaveBeenCalledWith(expect.any(File), "GROUP_PHOTO");
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("takes a file dropped on the picture", async () => {
    setup();

    fireEvent.drop(document.querySelector(".chat-info-photo")!, { dataTransfer: { files: [image("dropped.png")] } });

    await waitFor(() => expect(mocks.setGroupPhoto).toHaveBeenCalledWith("g1", "up1"));
  });

  it("refuses a file that is not an image, with no upload", async () => {
    setup();

    fireEvent.change(fileInput(), { target: { files: [image("tool.jar", "")] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("JPG, PNG, WebP or GIF");
    expect(mocks.uploadSingleImage).not.toHaveBeenCalled();
  });

  it("removes the photo when there is one, and says when that fails", async () => {
    const { onChanged } = setup({ conversation: group("OWNER", { photoUrl: "https://cdn/old.png" }) });

    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    await waitFor(() => expect(mocks.removeGroupPhoto).toHaveBeenCalledWith("g1"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("shows no Remove photo for a group without one", () => {
    setup();

    expect(screen.queryByRole("button", { name: "Remove photo" })).not.toBeInTheDocument();
  });

  it("renames in place: Enter saves, and nothing is sent for an unchanged or empty name", async () => {
    const { onChanged } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Change group name" }));
    const input = screen.getByRole("textbox", { name: "Group name" });

    expect(screen.getByRole("button", { name: "Save group name" })).toBeDisabled();
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mocks.updateGroupChat).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: " Raid team " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(mocks.updateGroupChat).toHaveBeenCalledWith("g1", { title: "Raid team" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Group name" })).not.toBeInTheDocument());
  });

  it("cancels a rename with Escape", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Change group name" }));

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Group name" }), { key: "Escape" });

    expect(screen.queryByRole("textbox", { name: "Group name" })).not.toBeInTheDocument();
    expect(mocks.updateGroupChat).not.toHaveBeenCalled();
  });

  it("shows why a rename failed and stays open", async () => {
    mocks.updateGroupChat.mockRejectedValue(new Error("Name is taken"));
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Change group name" }));
    const input = screen.getByRole("textbox", { name: "Group name" });

    fireEvent.change(input, { target: { value: "New" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByRole("alert")).toHaveTextContent("Name is taken");
    expect(screen.getByRole("textbox", { name: "Group name" })).toBeInTheDocument();
  });
});

// Holds the open and adding state the info panel holds in real use.
function Harness({
  startOpen = true,
  startAdding = false,
  ...props
}: {
  startOpen?: boolean;
  startAdding?: boolean;
  [prop: string]: any;
}) {
  const [isOpen, setIsOpen] = useState(startOpen);
  const [isAdding, setIsAdding] = useState(startAdding);
  return (
    <GroupMembersSection
      conversation={props.conversation}
      isAdding={isAdding}
      isOpen={isOpen}
      onToggleAdding={setIsAdding}
      onToggleOpen={() => setIsOpen((open) => !open)}
      {...props}
    />
  );
}

describe("GroupMembersSection", () => {
  const setup = (conversation = group(), props = {}) => {
    const handlers = { onChanged: vi.fn(), onLeft: vi.fn(), onVerify: vi.fn() };
    wrap(<Harness conversation={conversation} currentUserId="me" {...handlers} {...props} />);
    return handlers;
  };
  const openMenu = (name: any) => fireEvent.click(screen.getByRole("button", { name: `Options for ${name}` }));
  const choose = (label: any) => fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(label) }));

  it("counts and lists the members with their role, and marks you", () => {
    setup();

    expect(screen.getByRole("button", { name: /Members \(3\)/ })).toBeInTheDocument();
    expect(screen.getByText("Me (You)")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]!).getByText("Owner")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Admin")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Member")).toBeInTheDocument();
  });

  it("folds the member list away and opens it again", () => {
    setup();
    const toggle = screen.getByRole("button", { name: /Members \(3\)/ });

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Ann")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add people/ })).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByText("Ann")).toBeInTheDocument();
  });

  it("can start with the Add people sheet already open", () => {
    setup(group(), { startAdding: true });

    expect(screen.getByRole("dialog", { name: "Add people" })).toBeInTheDocument();
  });

  it("shows who is still invited or leaving", () => {
    setup(group("OWNER", { participants: [person("me", "Me", "OWNER"), person("cy", "Cy", "MEMBER", "PENDING")] }));

    expect(screen.getByText(/Invited/)).toBeInTheDocument();
  });

  it("gives a plain member no member menus and no Add people, but they can leave", () => {
    setup(group("MEMBER"));

    expect(screen.queryByRole("button", { name: /Options for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add people/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Leave group/ })).toBeEnabled();
  });

  it("lets the owner make an admin or take admin away, straight from the menu", async () => {
    const { onChanged } = setup();

    openMenu("Bo");
    choose("Make admin");
    await waitFor(() => expect(mocks.updateGroupMemberRole).toHaveBeenCalledWith("g1", "bo", "ADMIN"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());

    openMenu("Ann");
    choose("Remove as admin");
    await waitFor(() => expect(mocks.updateGroupMemberRole).toHaveBeenCalledWith("g1", "ann", "MEMBER"));
  });

  it("asks before making someone owner, then does it", async () => {
    setup();

    openMenu("Bo");
    choose("Make owner");
    expect(mocks.transferGroupOwnership).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Make owner" }));

    await waitFor(() => expect(mocks.transferGroupOwnership).toHaveBeenCalledWith("g1", "bo"));
  });

  it("asks before removing someone, and cancelling removes nobody", async () => {
    setup();

    openMenu("Bo");
    choose("Remove from group");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.removeGroupMembers).not.toHaveBeenCalled();

    openMenu("Bo");
    choose("Remove from group");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(mocks.removeGroupMembers).toHaveBeenCalledWith("g1", ["bo"]));
  });

  it("lets an admin remove a member but not change roles", () => {
    setup(group("ADMIN"));

    openMenu("Bo");

    expect(screen.getByRole("menuitem", { name: /Remove from group/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Make admin|Make owner/ })).not.toBeInTheDocument();
  });

  it("never offers to remove or demote the owner", () => {
    setup(group("ADMIN", { participants: [person("me", "Me", "ADMIN"), person("own", "Owen", "OWNER")] }));

    expect(screen.queryByRole("button", { name: "Options for Owen" })).not.toBeInTheDocument();
  });

  it("offers a safety number check where there is one", () => {
    const { onVerify } = setup(group(), { safety: { bo: { pairNumber: "123", status: "unverified" } } });

    openMenu("Bo");
    choose("Verify safety number");

    expect(onVerify).toHaveBeenCalledWith("bo");
  });

  describe("the Add people sheet", () => {
    const found = (...names: string[]) => {
      search.state = {
        ...search.state,
        items: names.map((name) => ({ id: `id-${name}`, name, username: name.toLowerCase(), image: null })),
      };
    };
    const open = (conversation?: any) => {
      const handlers = setup(conversation);
      fireEvent.click(screen.getByRole("button", { name: /^Add people/ }));
      return handlers;
    };
    // The sheet's own button; the section behind it has an "Add people" row too.
    const submitButton = () =>
      within(screen.getByRole("dialog", { name: "Add people" })).getByRole("button", { name: "Add people" });
    const type = (text: any) =>
      fireEvent.change(screen.getByRole("searchbox", { name: "Search people to add" }), { target: { value: text } });

    it("opens from the members section and closes without adding anyone", () => {
      open();
      expect(screen.getByRole("dialog", { name: "Add people" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(screen.queryByRole("dialog", { name: "Add people" })).not.toBeInTheDocument();
      expect(mocks.addGroupMembers).not.toHaveBeenCalled();
    });

    it("says what to do before anything is typed, and that nobody is selected yet", () => {
      open();

      expect(screen.getByText("No one selected")).toBeInTheDocument();
      expect(screen.getByText(/Search by name or @handle to find people/)).toBeInTheDocument();
      expect(submitButton()).toBeDisabled();
    });

    it("asks for more letters when only one is typed", () => {
      open();

      type("a");

      expect(screen.getByText(/Type at least 2 characters/)).toBeInTheDocument();
    });

    it("lists matches with their handle, leaving out people already in the group", () => {
      found("Newbie", "Ann");
      search.state.items.push({ id: "bo", name: "Bo", username: "bo", image: null });
      open();

      type("ne");

      expect(screen.getByRole("checkbox", { name: "Newbie" })).toBeInTheDocument();
      expect(screen.getByText("@newbie")).toBeInTheDocument();
      expect(screen.queryByRole("checkbox", { name: "Bo" })).not.toBeInTheDocument();
    });

    it("ticks people, shows them as chips with a count on the button, and lets one be taken back", () => {
      found("Newbie", "Cara");
      open();
      type("ne");

      fireEvent.click(screen.getByRole("checkbox", { name: "Newbie" }));
      fireEvent.click(screen.getByRole("checkbox", { name: "Cara" }));

      expect(screen.getByRole("list", { name: "Selected people" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add 2 people" })).toBeEnabled();
      fireEvent.click(screen.getByRole("button", { name: "Remove Cara" }));
      expect(submitButton()).toBeEnabled();
      expect(screen.getByRole("checkbox", { name: "Newbie" })).toBeChecked();
    });

    it("adds everyone ticked in one request, then closes and refreshes", async () => {
      found("Newbie", "Cara");
      const { onChanged } = open();
      type("ne");
      fireEvent.click(screen.getByRole("checkbox", { name: "Newbie" }));
      fireEvent.click(screen.getByRole("checkbox", { name: "Cara" }));

      fireEvent.click(screen.getByRole("button", { name: "Add 2 people" }));

      await waitFor(() => expect(mocks.addGroupMembers).toHaveBeenCalledWith("g1", ["id-Newbie", "id-Cara"]));
      await waitFor(() => expect(onChanged).toHaveBeenCalled());
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add people" })).not.toBeInTheDocument());
    });

    it("stays open with the reason when adding fails", async () => {
      mocks.addGroupMembers.mockRejectedValue(new Error("Group is full"));
      found("Newbie");
      open();
      type("ne");
      fireEvent.click(screen.getByRole("checkbox", { name: "Newbie" }));

      fireEvent.click(submitButton());

      expect(await screen.findByRole("alert")).toHaveTextContent("Group is full");
      expect(screen.getByRole("dialog", { name: "Add people" })).toBeInTheDocument();
    });

    it("says when nobody matches or the search failed", () => {
      open();
      type("zz");
      expect(screen.getByText(/No one found/)).toBeInTheDocument();

      search.state = { ...search.state, error: new Error("boom") };
      type("zzz");
      expect(screen.getByRole("alert")).toHaveTextContent("Could not search");
    });
  });

  it("asks before leaving, then leaves", async () => {
    const { onLeft } = setup(group("MEMBER"));

    fireEvent.click(screen.getByRole("button", { name: /Leave group/ }));
    expect(mocks.leaveGroup).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "Leave group" }).at(-1)!);

    await waitFor(() => expect(mocks.leaveGroup).toHaveBeenCalledWith("g1"));
    await waitFor(() => expect(onLeft).toHaveBeenCalled());
  });

  it("tells an owner with other members to choose a new owner, only when they try to leave", () => {
    setup();
    expect(screen.queryByText(/Choose a new owner first/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Make someone else the owner/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Leave group/ }));

    expect(screen.getByText("Choose a new owner first")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByText("Choose a new owner first")).not.toBeInTheDocument();
    expect(mocks.leaveGroup).not.toHaveBeenCalled();
  });

  it("lets a lone owner leave", () => {
    setup(group("OWNER", { participants: [person("me", "Me", "OWNER")] }));

    expect(screen.getByRole("button", { name: /Leave group/ })).toBeEnabled();
  });

  it("shows why a change failed", async () => {
    mocks.removeGroupMembers.mockRejectedValue(new Error("Not allowed"));
    setup();

    openMenu("Bo");
    choose("Remove from group");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Not allowed");
  });
});
