import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuotedSharedPost, SharedPostCard } from "../components/chat/SharedPostCard";

const mocks = vi.hoisted(() => ({ useQuery: vi.fn() }));

vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.useQuery }));
vi.mock("../lib/queries", () => ({ queries: { post: (id: any) => ({ queryKey: ["post", id] }) } }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const post = (extra = {}) => ({
  id: "p1",
  title: "Jinhsi build",
  content: "Everything you need to know.",
  author: "Moe",
  authorImage: null,
  gameName: "Wuthering Waves",
  isSpoiler: false,
  media: [
    { id: "m1", mediaType: "IMAGE", url: "https://res.cloudinary.com/x/a.jpg", altText: "build" },
  ],
  ...extra,
});
const ready = (data: any) => ({ data, isLoading: false, isError: false });

describe("SharedPostCard", () => {
  beforeEach(() => mocks.useQuery.mockReset());

  it("shows the post's picture, author, game and title, and links to the post", () => {
    mocks.useQuery.mockReturnValue(ready(post()));

    render(<SharedPostCard postId="p1" />);

    expect(screen.getByRole("link")).toHaveAttribute("href", "/post/p1");
    expect(screen.getByRole("img", { name: "build" })).toHaveAttribute(
      "src",
      "https://res.cloudinary.com/x/a.jpg",
    );
    expect(screen.getByText("Moe")).toBeInTheDocument();
    expect(screen.getByText("Wuthering Waves")).toBeInTheDocument();
    expect(screen.getByText("Jinhsi build")).toBeInTheDocument();
    expect(screen.getByText("Everything you need to know.")).toBeInTheDocument();
  });

  it("falls back to the start of the text for a post with no title", () => {
    mocks.useQuery.mockReturnValue(
      ready(post({ title: "", content: "just a thought", media: [] })),
    );

    render(<SharedPostCard postId="p1" />);

    expect(screen.getByText("just a thought")).toBeInTheDocument();
  });

  it("marks a video with a play badge instead of playing it", () => {
    mocks.useQuery.mockReturnValue(
      ready(
        post({
          media: [{ id: "v", mediaType: "VIDEO", url: "https://res.cloudinary.com/x/v.mp4" }],
        }),
      ),
    );

    const { container } = render(<SharedPostCard postId="p1" />);

    expect(container.querySelector("video")).not.toHaveAttribute("controls");
    expect(container.querySelector(".chat-shared-post-play")).toBeInTheDocument();
  });

  it("covers a spoiler until it is revealed", () => {
    mocks.useQuery.mockReturnValue(ready(post({ isSpoiler: true })));

    const { container } = render(<SharedPostCard postId="p1" />);
    expect(container.querySelector(".chat-shared-post-media.covered")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /reveal spoiler/i }));

    expect(container.querySelector(".chat-shared-post-media.covered")).not.toBeInTheDocument();
  });

  it("says a post is unavailable when the server will not show it to this viewer", () => {
    mocks.useQuery.mockReturnValue({ isLoading: false, isError: true, error: { status: 404 } });

    render(<SharedPostCard postId="p1" />);

    expect(screen.getByText("Post unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("offers a retry when the post could not be loaded for another reason", () => {
    const refetch = vi.fn();
    mocks.useQuery.mockReturnValue({
      isLoading: false,
      isError: true,
      error: { status: 500 },
      refetch,
    });

    render(<SharedPostCard postId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(screen.getByText("Could not load this post")).toBeInTheDocument();
    expect(refetch).toHaveBeenCalled();
  });

  it("holds its place while loading", () => {
    mocks.useQuery.mockReturnValue({ isLoading: true });

    const { container } = render(<SharedPostCard postId="p1" />);

    expect(container.querySelector(".chat-shared-post.loading")).toBeInTheDocument();
  });
});

describe("QuotedSharedPost", () => {
  beforeEach(() => mocks.useQuery.mockReset());

  it("shows the picture and title of the quoted post", () => {
    mocks.useQuery.mockReturnValue(ready(post()));

    const { container } = render(<QuotedSharedPost postId="p1" />);

    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://res.cloudinary.com/x/a.jpg",
    );
    expect(screen.getByText("Jinhsi build")).toBeInTheDocument();
  });

  it("just says a post while it is not loaded or not visible", () => {
    mocks.useQuery.mockReturnValue({ data: undefined });

    render(<QuotedSharedPost postId="p1" />);

    expect(screen.getByText("a post")).toBeInTheDocument();
  });
});
