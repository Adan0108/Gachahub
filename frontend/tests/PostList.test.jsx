import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PostList } from "../components/PostList";

const mocks = vi.hoisted(() => ({
  likePost: vi.fn(),
  getFollowStatus: vi.fn(() => Promise.resolve({ following: false })),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => ({ data: null, isLoading: false, isError: false })),
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
  useMutation: ({ onMutate, onError, onSettled }) => ({
    isPending: false,
    isError: false,
    mutate: () => {
      const context = onMutate?.();
      onError?.(new Error("failed"), undefined, context);
      onSettled?.();
    },
  }),
}));
vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "viewer" }, isAuthenticated: true }),
}));
vi.mock("../lib/api", () => ({
  api: {
    likePost: mocks.likePost,
    unlikePost: vi.fn(),
    getFollowStatus: mocks.getFollowStatus,
    followUser: vi.fn(),
    unfollowUser: vi.fn(),
    getComments: vi.fn(),
    getReplies: vi.fn(),
    createComment: vi.fn(),
    createReply: vi.fn(),
  },
  fallbackCategories: vi.fn(),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(),
  fallbackPosts: vi.fn(),
}));

describe("PostList", () => {
  it("rolls back a failed optimistic like and skips feed follow-status requests", async () => {
    const { container } = render(
      <PostList
        posts={[
          {
            id: "post-1",
            title: "Test post",
            author: "Author",
            authorId: "author",
            time: "Now",
            tag: "Guide",
            likeCount: 2,
            likedByCurrentUser: false,
          },
        ]}
      />,
    );
    const likeButton = container.querySelector('.post-social button[aria-pressed="false"]');

    fireEvent.click(likeButton);
    expect(likeButton).toHaveTextContent("2");
    expect(mocks.getFollowStatus).not.toHaveBeenCalled();
  });
});
