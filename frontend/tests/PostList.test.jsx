import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PostList } from "../components/PostList";

const mocks = vi.hoisted(() => ({
  createReply: vi.fn(),
  likePost: vi.fn(),
  getFollowStatus: vi.fn(() => Promise.resolve({ following: false })),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn((options) => ({
    data:
      options.queryKey?.[0] === "comments"
        ? {
            items: [
              {
                id: "comment-1",
                content: "Original comment",
                author: { name: "Reviewer" },
                replyCount: 0,
              },
            ],
          }
        : null,
    isLoading: false,
    isError: false,
  })),
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
  useMutation: ({ mutationFn, onMutate, onError, onSettled }) => ({
    isPending: false,
    isError: false,
    mutate: () => {
      mutationFn?.();
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
    createReply: mocks.createReply,
  },
  fallbackCategories: vi.fn(),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(),
  fallbackPosts: vi.fn(),
}));

describe("PostList", () => {
  it("uses the QuickTime MIME type for MOV videos", () => {
    const { container } = render(
      <PostList
        posts={[
          {
            id: "post-with-mov",
            title: "MOV preview",
            author: "Author",
            authorId: "author",
            media: [
              {
                id: "media-1",
                mediaType: "VIDEO",
                format: "mov",
                url: "https://example.com/preview.mov",
              },
            ],
          },
        ]}
        variant="feed"
      />,
    );

    expect(container.querySelector("video source")).toHaveAttribute("type", "video/quicktime");
  });

  it("submits a reply when Enter is pressed", () => {
    mocks.createReply.mockClear();
    const { container } = render(
      <PostList
        posts={[
          {
            id: "post-1",
            title: "Test post",
            author: "Author",
            authorId: "author",
            commentCount: 1,
          },
        ]}
      />,
    );

    fireEvent.click(container.querySelector(".post-social button:nth-child(2)"));
    fireEvent.click(screen.getByRole("button", { name: /^reply$/i }));
    const replyInput = screen.getByRole("textbox", { name: /reply to/i });
    fireEvent.change(replyInput, { target: { value: "Sounds good" } });
    fireEvent.keyDown(replyInput, { key: "Enter", code: "Enter" });

    expect(mocks.createReply).toHaveBeenCalledWith("comment-1", "Sounds good");
  });

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

  it("renders the Home feed layout and enlarges post images", () => {
    const { container } = render(
      <PostList
        posts={[
          {
            id: "post-image",
            title: "Screenshot showcase",
            author: "Rover",
            time: "Now",
            tag: "Fan Art",
            media: [{ id: "image-1", mediaType: "IMAGE", url: "https://example.com/art.jpg" }],
          },
        ]}
        variant="feed"
      />,
    );

    expect(container.querySelector(".post-feed-card")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /screenshot showcase/i })).toHaveAttribute(
      "href",
      "/post/post-image",
    );

    fireEvent.click(screen.getByRole("button", { name: /enlarge screenshot showcase/i }));
    expect(
      screen.getByRole("dialog", { name: /screenshot showcase image preview/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /close image preview/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps compact lists text-only", () => {
    render(
      <PostList
        posts={[
          {
            id: "compact-post",
            title: "Compact result",
            author: "Rover",
            content: "This belongs on the detail page.",
            media: [{ id: "image-1", mediaType: "IMAGE", url: "/mock-feed-art.svg" }],
          },
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: /compact result/i })).toHaveAttribute(
      "href",
      "/post/compact-post",
    );
    expect(screen.queryByText("This belongs on the detail page.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /enlarge/i })).not.toBeInTheDocument();
  });
});
