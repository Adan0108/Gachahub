import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CreatePostPage from "../app/create/page";

const mocks = vi.hoisted(() => ({ createPost: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("../hooks/useRequireAuth", () => ({
  useRequireAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));
vi.mock("../lib/queries", () => ({
  queries: {
    games: () => ({
      queryKey: ["games"],
      queryFn: async () => ({ items: [{ id: "game", name: "Test Game", slug: "test-game" }] }),
    }),
    categories: (slug) => ({
      queryKey: ["categories", slug],
      queryFn: async () => [{ id: "category", name: "Guides" }],
    }),
  },
}));
vi.mock("../lib/api", () => ({
  api: {
    createPost: mocks.createPost,
    uploadPostMedia: async () => ({ successful: [], failed: [] }),
  },
}));

function renderComposer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CreatePostPage />
    </QueryClientProvider>,
  );
}

describe("personal/community composer smoke", () => {
  beforeEach(() => {
    mocks.createPost.mockResolvedValue({ id: "created" });
  });

  it("publishes content-only personal posts without classification controls", async () => {
    renderComposer();
    expect(screen.getByLabelText("Post to")).toHaveValue("");
    expect(screen.queryByLabelText("Post type")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Category/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Content"), {
      target: { value: "Personal pull story" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish post" }));
    await waitFor(() =>
      expect(mocks.createPost).toHaveBeenCalledWith(
        expect.objectContaining({ gameId: null, content: "Personal pull story" }),
      ),
    );
    const payload = mocks.createPost.mock.calls[0][0];
    expect(payload).not.toHaveProperty("type");
    expect(payload).not.toHaveProperty("categoryId");
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/profile"));
  });

  it("shows community controls and publishes community metadata", async () => {
    renderComposer();
    await screen.findByRole("option", { name: "Test Game" });
    fireEvent.change(screen.getByLabelText("Post to"), { target: { value: "game" } });
    fireEvent.change(screen.getByLabelText("Post type"), { target: { value: "GUIDE" } });
    await screen.findByRole("option", { name: "Guides" });
    fireEvent.change(screen.getByLabelText(/Category/), { target: { value: "category" } });
    fireEvent.change(screen.getByPlaceholderText("Give your post a clear title"), {
      target: { value: "Community guide" },
    });
    fireEvent.change(screen.getByLabelText("Content"), { target: { value: "Guide body" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish post" }));
    await waitFor(() =>
      expect(mocks.createPost).toHaveBeenCalledWith(
        expect.objectContaining({ gameId: "game", type: "GUIDE", categoryId: "category" }),
      ),
    );
  });

  it("drops stale classification after switching from community back to personal", async () => {
    renderComposer();
    await screen.findByRole("option", { name: "Test Game" });
    fireEvent.change(screen.getByLabelText("Post to"), { target: { value: "game" } });
    fireEvent.change(screen.getByLabelText("Post type"), { target: { value: "GUIDE" } });
    fireEvent.change(screen.getByLabelText("Post to"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Content"), { target: { value: "Personal again" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish post" }));
    await waitFor(() => expect(mocks.createPost).toHaveBeenCalled());
    expect(mocks.createPost.mock.calls[0][0]).not.toHaveProperty("type");
    expect(screen.queryByLabelText("Post type")).not.toBeInTheDocument();
  });
});
