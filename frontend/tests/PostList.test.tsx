import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PostItem, PostList } from "../components/PostList";

const mocks = vi.hoisted(() => ({
  createReply: vi.fn(),
  likePost: vi.fn(),
  getFollowStatus: vi.fn(() => Promise.resolve({ following: false })),
  createReport: vi.fn(() => Promise.resolve({ id: "report-1" })),
  share: vi.fn(() => Promise.resolve()),
  push: vi.fn(),
  isAuthenticated: true,
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
                author: { id: "reviewer", name: "Reviewer", username: "rev" },
                replyCount: 1,
              },
            ],
          }
        : options.queryKey?.[0] === "comment-replies"
          ? { items: [{ id: "reply-1", content: "A reply", author: { name: "Replier" } }] }
          : null,
    isLoading: false,
    isError: false,
  })),
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
  useMutation: ({
    mutationFn,
    onMutate,
    onError,
    onSettled,
  }: {
    mutationFn?: () => unknown;
    onMutate?: () => unknown;
    onError?: (error: Error, variables: undefined, context: unknown) => void;
    onSettled?: () => unknown;
  }) => ({
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
  useCurrentUser: () => ({ user: { id: "viewer" }, isAuthenticated: mocks.isAuthenticated }),
}));
// The real dialog needs the chat engine; here it only has to open and hand back its two actions.
vi.mock("../components/SharePostDialog", () => ({
  SharePostDialog: ({ postId, onClose, onNativeShare }: any) => (
    <div role="dialog" aria-label={`share ${postId}`}>
      <button onClick={onNativeShare} type="button">
        native share
      </button>
      <button onClick={onClose} type="button">
        close dialog
      </button>
    </div>
  ),
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
    createReport: mocks.createReport,
  },
  fallbackCategories: vi.fn(),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(),
  fallbackPosts: vi.fn(),
}));

describe("PostList", () => {
  it("leaves the full body on the post detail page", () => {
    const content = "Full post text. ".repeat(1000);
    const { container } = render(
      <PostItem
        index={0}
        detail
        post={{ id: "detail-post", title: "Detail post", author: "Author", content }}
      />,
    );

    expect(container.querySelector(".post-body.full > p")).toHaveTextContent(content.trim());
    expect(screen.queryByRole("link", { name: "Read full post" })).not.toBeInTheDocument();
  });

  it("keeps long feed bodies in the preview and links to the full post", () => {
    const content = "A long post body. ".repeat(1000);
    const { container } = render(
      <PostList
        posts={[{ id: "long-post", title: "Long post", author: "Author", content }]}
        variant="feed"
      />,
    );

    expect(container.querySelector(".post-feed-card .post-body:not(.full) > p")).toHaveTextContent(
      content.trim(),
    );
    expect(screen.getByRole("link", { name: "Read full post" })).toHaveAttribute(
      "href",
      "/post/long-post",
    );
  });

  it("opens the send dialog for a signed-in reader, which can still use the browser share sheet", async () => {
    mocks.share.mockClear();
    mocks.isAuthenticated = true;
    Object.defineProperty(navigator, "share", { configurable: true, value: mocks.share });

    render(
      <PostList
        posts={[{ id: "post-share", title: "Share me", author: "Author", content: "Body" }]}
        variant="feed"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^share$/i }));
    expect(screen.getByRole("dialog", { name: "share post-share" })).toBeInTheDocument();
    expect(mocks.share).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "native share" }));
    await waitFor(() =>
      expect(mocks.share).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Share me",
          url: expect.stringContaining("/post/post-share"),
        }),
      ),
    );
  });

  it("shares straight to the browser share sheet for someone not signed in", async () => {
    mocks.share.mockClear();
    mocks.isAuthenticated = false;
    Object.defineProperty(navigator, "share", { configurable: true, value: mocks.share });

    render(
      <PostList
        posts={[{ id: "post-guest", title: "Share me", author: "Author", content: "Body" }]}
        variant="feed"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^share$/i }));

    await waitFor(() => expect(mocks.share).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    mocks.isAuthenticated = true;
  });

  it("opens the post menu and submits a report", async () => {
    mocks.createReport.mockClear();
    render(
      <PostList
        posts={[{ id: "post-report", title: "Report me", author: "Author" }]}
        variant="feed"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /more options for report me/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^report$/i }));
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "COMMERCIAL_SPAM" } });
    fireEvent.change(screen.getByLabelText(/details/i), { target: { value: "Repeated ads" } });
    fireEvent.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() =>
      expect(mocks.createReport).toHaveBeenCalledWith({
        targetType: "POST",
        targetId: "post-report",
        reasonCode: "COMMERCIAL_SPAM",
        details: "Repeated ads",
      }),
    );
  });

  it("submits a comment complaint using the comment ID and native target type", async () => {
    mocks.createReport.mockClear();
    render(
      <PostList
        posts={[{ id: "post-comment-report", title: "Comment report", author: "Author" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Comments on Comment report" }));
    fireEvent.click(screen.getByRole("button", { name: "Report comment" }));
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "HARASSMENT" } });
    fireEvent.change(screen.getByLabelText(/details/i), { target: { value: "Comment evidence" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit report" }));
    await waitFor(() =>
      expect(mocks.createReport).toHaveBeenCalledWith({
        targetType: "COMMENT",
        targetId: "comment-1",
        reasonCode: "HARASSMENT",
        details: "Comment evidence",
      }),
    );
  });

  it("asks a guest to sign in before opening comment reporting", () => {
    mocks.isAuthenticated = false;
    mocks.push.mockClear();
    const { container } = render(
      <PostList posts={[{ id: "guest-report", title: "Guest report", author: "Author" }]} />,
    );
    fireEvent.click(container.querySelector(".post-social button:nth-child(2)")!);
    fireEvent.click(screen.getByRole("button", { name: "Report comment" }));
    expect(mocks.push).toHaveBeenCalledWith("/login");
    expect(screen.queryByRole("dialog", { name: /Report comment/ })).not.toBeInTheDocument();
    mocks.isAuthenticated = true;
  });

  it("reports a reply as COMMENT evidence using the reply ID", async () => {
    mocks.createReport.mockClear();
    render(<PostList posts={[{ id: "reply-report", title: "Reply report", author: "Author" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Comments on Reply report" }));
    fireEvent.click(screen.getByRole("button", { name: "View 1 replies" }));
    fireEvent.click(screen.getByRole("button", { name: "Report reply" }));
    expect(screen.getByRole('button',{name:'Submit report'})).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/reason/i), {target:{value:'UNMARKED_SPOILERS'}});
    expect(screen.getByRole("heading", { name: "What’s wrong with this comment?" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Submit report" }));
    await waitFor(() =>
      expect(mocks.createReport).toHaveBeenCalledWith({
        targetType: "COMMENT",
        targetId: "reply-1",
        reasonCode: "UNMARKED_SPOILERS",
      }),
    );
  });

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

    expect(container.querySelector("video source")!).toHaveAttribute("type", "video/quicktime");
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

    fireEvent.click(container.querySelector(".post-social button:nth-child(2)")!);
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
    const likeButton = container.querySelector('.post-social button[aria-pressed="false"]')!;

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

    expect(container.querySelector(".post-feed-card")!).toBeInTheDocument();
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

  it("links the author's picture on a feed post to their profile", () => {
    render(
      <PostList
        posts={[{ id: "p1", title: "Hello", author: "Rover", authorId: "rover-1", time: "Now" }]}
        variant="feed"
      />,
    );

    expect(screen.getByRole("link", { name: "Rover's profile" })).toHaveAttribute(
      "href",
      "/user/rover-1",
    );
  });

  it("links a comment's author to their profile", () => {
    const { container } = render(
      <PostList
        posts={[{ id: "post-1", title: "Test post", author: "A", authorId: "a", commentCount: 1 }]}
      />,
    );

    fireEvent.click(container.querySelector(".post-social button:nth-child(2)")!);

    expect(screen.getByRole("link", { name: /Reviewer/ })).toHaveAttribute(
      "href",
      "/user/reviewer",
    );
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
