import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UserProfilePage from "../app/user/[id]/page";
import { ProfileView } from "../components/profile/ProfileView";
import { compactCount, joinedLabel, profileToShow } from "../lib/profile/profileView";

const mocks = vi.hoisted(() => ({
  me: { id: "me", name: "Me", username: "me", bio: "my bio", image: null, bannerPresetId: null },
  push: vi.fn(),
  replace: vi.fn(),
  api: {
    getUserProfile: vi.fn(),
    getUserPosts: vi.fn(),
    getMyPosts: vi.fn(),
    getFollowers: vi.fn(),
    getFollowing: vi.fn(),
    followUser: vi.fn(),
    unfollowUser: vi.fn(),
    updateProfile: vi.fn(),
    getBannerOptions: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  useParams: () => ({ id: "bo" }),
}));
vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: mocks.me, isAuthenticated: Boolean(mocks.me), isLoading: false }),
}));
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: { ...actual.api, ...mocks.api } };
});
vi.mock("../components/PostList", () => ({
  PostList: ({ posts }) => (
    <ul>
      {posts.map((post) => (
        <li key={post.id}>{post.title}</li>
      ))}
    </ul>
  ),
}));
vi.mock("../components/profile/AvatarEditor", () => ({ AvatarEditor: () => null }));
vi.mock("../components/profile/BannerPicker", () => ({ BannerPicker: () => null }));

const profile = (extra = {}) => ({
  id: "bo",
  name: "Bo Bear",
  username: "bobear",
  image: null,
  bannerPresetId: null,
  bio: "I roll gacha.",
  createdAt: "2026-03-05T00:00:00.000Z",
  isBlockedByMe: false,
  isFollowing: false,
  followsYou: false,
  isPrivate: false,
  counts: { posts: 3, followers: 1200, following: 7 },
  ...extra,
});
const person = (id, extra = {}) => ({
  id,
  name: `Person ${id}`,
  username: id,
  image: null,
  isFollowing: false,
  followsYou: false,
  ...extra,
});

function mount(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { ...view, client };
}

describe("profile helpers", () => {
  it("draws your own profile from your live account, and anyone else's as sent", () => {
    const sent = profile({ id: "me", name: "Old", bio: "old bio" });

    expect(profileToShow(sent, mocks.me, true)).toMatchObject({ name: "Me", bio: "my bio" });
    expect(profileToShow(sent, mocks.me, false)).toBe(sent);
  });

  it("writes counts short and the join date as month and year", () => {
    expect(compactCount(1200, "en")).toBe("1.2K");
    expect(compactCount(undefined, "en")).toBe("0");
    expect(joinedLabel("2026-03-05T00:00:00.000Z", "en")).toBe("Joined March 2026");
    expect(joinedLabel("nonsense")).toBe("");
  });
});

describe("someone else's profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.me = { id: "me", name: "Me", username: "me", bio: "my bio", image: null };
    mocks.api.getUserPosts.mockResolvedValue({
      items: [{ id: "p1", title: "A post of Bo" }],
      meta: { total: 1 },
    });
    mocks.api.followUser.mockResolvedValue({ following: true });
    mocks.api.unfollowUser.mockResolvedValue({ following: false });
    mocks.api.getFollowers.mockResolvedValue({ items: [person("ann")], nextCursor: null });
    mocks.api.getFollowing.mockResolvedValue({ items: [person("cy")], nextCursor: null });
  });

  it("shows the name, handle, bio and counts, and their posts", async () => {
    mount(<ProfileView isSelf={false} me={mocks.me} profile={profile()} />);

    expect(screen.getByRole("heading", { name: "Bo Bear" })).toBeInTheDocument();
    expect(screen.getByText("@bobear")).toBeInTheDocument();
    expect(screen.getByText("I roll gacha.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1\.2K\s*Followers/ })).toBeInTheDocument();
    expect(await screen.findByText("A post of Bo")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit Profile/ })).toBeNull();
  });

  it("follows at once, and the follower count goes up", async () => {
    mocks.api.getUserProfile.mockResolvedValue(
      profile({ counts: { posts: 3, followers: 10, following: 7 } }),
    );
    mount(<UserProfilePage />);

    // The server now says what the optimistic update showed.
    mocks.api.followUser.mockImplementation(async () => {
      mocks.api.getUserProfile.mockResolvedValue(
        profile({ isFollowing: true, counts: { posts: 3, followers: 11, following: 7 } }),
      );
      return { following: true };
    });
    fireEvent.click(await screen.findByRole("button", { name: /^Follow$/ }));

    await waitFor(() => expect(mocks.api.followUser).toHaveBeenCalledWith("bo"));
    expect(await screen.findByRole("button", { name: /Followings*Unfollow/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /^11\s*Followers/ })).toBeInTheDocument();
  });

  it("unfollows someone already followed", async () => {
    mocks.api.getUserProfile.mockResolvedValue(profile({ isFollowing: true }));
    mount(<UserProfilePage />);

    fireEvent.click(await screen.findByRole("button", { name: /Following\s*Unfollow/ }));

    await waitFor(() => expect(mocks.api.unfollowUser).toHaveBeenCalledWith("bo"));
  });

  it("offers Follow back to someone who follows you, and says so", () => {
    mount(<ProfileView isSelf={false} me={mocks.me} profile={profile({ followsYou: true })} />);

    expect(screen.getByRole("button", { name: /Follow back/ })).toBeInTheDocument();
    expect(screen.getByText("Follows you")).toBeInTheDocument();
  });

  it("sends someone who is signed out to log in instead of following", () => {
    mocks.me = null;
    mount(<ProfileView isSelf={false} me={null} profile={profile()} />);

    fireEvent.click(screen.getByRole("button", { name: /^Follow/ }));

    expect(mocks.push).toHaveBeenCalledWith("/login");
    expect(mocks.api.followUser).not.toHaveBeenCalled();
  });

  it("has no follow button for someone you blocked", () => {
    mount(<ProfileView isSelf={false} me={mocks.me} profile={profile({ isBlockedByMe: true })} />);

    expect(screen.queryByRole("button", { name: /^Follow/ })).toBeNull();
    expect(screen.getByText("You blocked this person")).toBeInTheDocument();
  });

  it("opens the followers list, with follow buttons for everyone but you", async () => {
    mocks.api.getFollowers.mockResolvedValue({
      items: [person("ann"), person("me", { name: "Me" })],
      nextCursor: null,
    });
    mount(<ProfileView isSelf={false} me={mocks.me} profile={profile()} />);

    fireEvent.click(screen.getByRole("button", { name: /Followers/ }));

    const dialog = await screen.findByRole("dialog", { name: "Followers" });
    expect(await within(dialog).findByText("Person ann")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("button", { name: /^Follow/ })).toHaveLength(1);
    expect(within(dialog).getByRole("link", { name: /Person ann/ })).toHaveAttribute(
      "href",
      "/user/ann",
    );
  });

  it("loads more people when there are more", async () => {
    mocks.api.getFollowing
      .mockResolvedValueOnce({ items: [person("a")], nextCursor: "a" })
      .mockResolvedValueOnce({ items: [person("b")], nextCursor: null });
    mount(<ProfileView isSelf={false} me={mocks.me} profile={profile()} />);

    fireEvent.click(screen.getByRole("button", { name: /^7\s*Following/ }));
    const dialog = await screen.findByRole("dialog", { name: "Following" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Show more" }));

    expect(await within(dialog).findByText("Person b")).toBeInTheDocument();
    expect(mocks.api.getFollowing).toHaveBeenLastCalledWith(
      "bo",
      { cursor: "a", limit: 20 },
      expect.anything(),
    );
    expect(within(dialog).queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("says when a list is empty", async () => {
    mocks.api.getFollowers.mockResolvedValue({ items: [], nextCursor: null });
    mount(<ProfileView isSelf={false} me={mocks.me} profile={profile()} />);

    fireEvent.click(screen.getByRole("button", { name: /Followers/ }));

    expect(await screen.findByText("No followers yet.")).toBeInTheDocument();
  });

  it("shows the About tab with the join date", () => {
    mount(<ProfileView isSelf={false} me={mocks.me} profile={profile()} />);

    fireEvent.click(screen.getByRole("tab", { name: "About" }));

    expect(screen.getByText(/^Joined /)).toBeInTheDocument();
  });
});

describe("your own profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.me = { id: "me", name: "Me", username: "me", bio: "my bio", image: null };
    mocks.api.getMyPosts.mockResolvedValue({ items: [], meta: { total: 0 } });
  });

  it("has Edit instead of Follow, and shows your live name and bio", () => {
    mount(
      <ProfileView
        isSelf
        me={mocks.me}
        profile={profile({ id: "me", name: "Stale", bio: "stale" })}
      />,
    );

    expect(screen.getByRole("heading", { name: "Me" })).toBeInTheDocument();
    expect(screen.getByText("my bio")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Edit Profile/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Follow/ })).toBeNull();
  });

  it("saves a new name and bio for real, and shows them", async () => {
    mocks.api.updateProfile.mockResolvedValue({ id: "me", name: "New Name", bio: "new bio" });
    const { client } = mount(<ProfileView isSelf me={mocks.me} profile={profile({ id: "me" })} />);
    client.setQueryData(["current-user"], mocks.me);

    fireEvent.click(screen.getByRole("button", { name: /Edit Profile/ }));
    const dialog = await screen.findByRole("dialog", { name: "Edit profile" });
    fireEvent.change(within(dialog).getByLabelText("Display name"), {
      target: { value: "  New Name " },
    });
    fireEvent.change(within(dialog).getByLabelText("Bio"), { target: { value: "new bio" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(mocks.api.updateProfile).toHaveBeenCalledWith({ name: "New Name", bio: "new bio" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(client.getQueryData(["current-user"])).toMatchObject({
      name: "New Name",
      bio: "new bio",
    });
  });

  it("will not save an unchanged profile or a name that is too short", () => {
    mount(<ProfileView isSelf me={mocks.me} profile={profile({ id: "me" })} />);

    fireEvent.click(screen.getByRole("button", { name: /Edit Profile/ }));
    const dialog = screen.getByRole("dialog", { name: "Edit profile" });
    const save = within(dialog).getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("Display name"), { target: { value: "x" } });
    expect(save).toBeDisabled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("2 to 50");
  });

  it("shows the error when saving fails, and keeps the dialog open", async () => {
    mocks.api.updateProfile.mockRejectedValue(new Error("Server said no"));
    mount(<ProfileView isSelf me={mocks.me} profile={profile({ id: "me" })} />);

    fireEvent.click(screen.getByRole("button", { name: /Edit Profile/ }));
    const dialog = screen.getByRole("dialog", { name: "Edit profile" });
    fireEvent.change(within(dialog).getByLabelText("Bio"), { target: { value: "changed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(await within(dialog).findByText("Server said no")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Edit profile" })).toBeInTheDocument();
  });
});

describe("the page for another user", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.me = { id: "me", name: "Me", username: "me", bio: null, image: null };
    mocks.api.getUserPosts.mockResolvedValue({ items: [], meta: { total: 0 } });
  });

  it("loads the profile by id", async () => {
    mocks.api.getUserProfile.mockResolvedValue(profile());
    mount(<UserProfilePage />);

    expect(await screen.findByRole("heading", { name: "Bo Bear" })).toBeInTheDocument();
    expect(mocks.api.getUserProfile).toHaveBeenCalledWith("bo", expect.anything());
  });

  it("says when there is no such user", async () => {
    mocks.api.getUserProfile.mockRejectedValue(Object.assign(new Error("nope"), { status: 404 }));
    mount(<UserProfilePage />);

    expect(await screen.findByText("User not found")).toBeInTheDocument();
  });

  it("sends you to your own profile page when the id is yours", () => {
    mocks.me = { id: "bo", name: "Me" };
    mocks.api.getUserProfile.mockResolvedValue(profile());
    mount(<UserProfilePage />);

    expect(mocks.replace).toHaveBeenCalledWith("/profile");
  });
});
