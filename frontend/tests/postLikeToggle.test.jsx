import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostItem } from "../components/PostList";

const mocks = vi.hoisted(() => ({ likePost: vi.fn(), unlikePost: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "viewer" }, isAuthenticated: true }),
}));
vi.mock("../lib/api", () => ({
  api: {
    likePost: mocks.likePost,
    unlikePost: mocks.unlikePost,
    getFollowStatus: vi.fn(() => Promise.resolve({ following: false })),
    getComments: vi.fn(() => Promise.resolve({ items: [] })),
  },
  fallbackCategories: vi.fn(() => []),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(() => ({ items: [] })),
  fallbackPosts: vi.fn(() => []),
}));

/** What the server currently believes, so a like or unlike changes what the next refetch returns. */
let server;

const serverPost = () => ({
  id: "post-1",
  title: "A post",
  author: "Author",
  likedByCurrentUser: server.liked,
  likeCount: server.count,
});

/** The post as the app really gets it: from the query a page keeps its list in (the home feed, a community feed, or a post list). */
function Feed({ queryKey }) {
  const { data } = useQuery({ queryKey, queryFn: async () => [serverPost()] });
  return data ? <PostItem post={data[0]} variant="feed" /> : null;
}

const HOME_FEED = ["feed", "latest", { limit: 10 }, "viewer", null];
const COMMUNITY_FEED = ["game-feed", "neverness-to-everness", { sort: "latest", userId: "viewer" }];
const POST_LIST = ["posts", { search: "" }];

function renderFeed(queryKey = HOME_FEED) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Feed queryKey={queryKey} />
    </QueryClientProvider>,
  );
}

const heart = () => screen.findByRole("button", { name: /^(Like|Unlike) A post$/ });

describe("liking a post", () => {
  beforeEach(() => {
    server = { liked: false, count: 0 };
    mocks.likePost.mockReset().mockImplementation(async () => {
      server = { liked: true, count: server.count + 1 };
      return { liked: true, likeCount: server.count };
    });
    mocks.unlikePost.mockReset().mockImplementation(async () => {
      server = { liked: false, count: Math.max(0, server.count - 1) };
      return { liked: false, likeCount: server.count };
    });
  });

  it("sends a like, not an unlike, when an unliked post is pressed", async () => {
    renderFeed();

    fireEvent.click(await heart());

    await waitFor(() => expect(mocks.likePost).toHaveBeenCalledWith("post-1"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.likePost).toHaveBeenCalledTimes(1);
    expect(mocks.unlikePost).not.toHaveBeenCalled();
  });

  it("sends an unlike, not a like, when a liked post is pressed", async () => {
    server = { liked: true, count: 3 };
    renderFeed();

    fireEvent.click(await heart());

    await waitFor(() => expect(mocks.unlikePost).toHaveBeenCalledWith("post-1"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.unlikePost).toHaveBeenCalledTimes(1);
    expect(mocks.likePost).not.toHaveBeenCalled();
  });

  it("stays liked once the server has answered and the feed has refetched", async () => {
    renderFeed();

    fireEvent.click(await heart());

    await waitFor(() => expect(mocks.likePost).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 100));
    const pressed = await heart();
    expect(pressed).toHaveAttribute("aria-pressed", "true");
    expect(pressed).toHaveTextContent("1");
  });

  it.each([
    ["the home feed", HOME_FEED],
    ["a community feed", COMMUNITY_FEED],
    ["a plain post list", POST_LIST],
  ])("stays liked in %s once the server has answered", async (_name, queryKey) => {
    renderFeed(queryKey);

    fireEvent.click(await heart());

    await waitFor(() => expect(mocks.likePost).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await heart()).toHaveAttribute("aria-pressed", "true");
  });

  it("stays unliked once an unlike has been answered and the feed has refetched", async () => {
    server = { liked: true, count: 2 };
    renderFeed();

    fireEvent.click(await heart());

    await waitFor(() => expect(mocks.unlikePost).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 100));
    const unpressed = await heart();
    expect(unpressed).toHaveAttribute("aria-pressed", "false");
    expect(unpressed).toHaveTextContent("1");
  });

  it("shows the like straight away, before the server has answered", async () => {
    mocks.likePost.mockReturnValue(new Promise(() => {}));
    renderFeed();

    fireEvent.click(await heart());

    const pressed = await screen.findByRole("button", { name: "Unlike A post" });
    expect(pressed).toHaveAttribute("aria-pressed", "true");
    expect(pressed).toHaveTextContent("1");
  });

  it("goes back to unliked, with the old count, when the like fails", async () => {
    mocks.likePost.mockRejectedValue(new Error("nope"));
    server = { liked: false, count: 4 };
    renderFeed();

    fireEvent.click(await heart());

    await waitFor(() => expect(mocks.likePost).toHaveBeenCalled());
    await waitFor(async () => expect(await heart()).toHaveAttribute("aria-pressed", "false"));
    expect(await heart()).toHaveTextContent("4");
  });

  it("can be liked, unliked and liked again", async () => {
    renderFeed();

    for (const expected of [true, false, true]) {
      fireEvent.click(await heart());
      await waitFor(async () => expect(await heart()).toHaveAttribute("aria-pressed", String(expected)));
      await waitFor(() => expect(server.liked).toBe(expected));
    }

    expect(mocks.likePost).toHaveBeenCalledTimes(2);
    expect(mocks.unlikePost).toHaveBeenCalledTimes(1);
  });
});
