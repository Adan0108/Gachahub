import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CreatePostPage from "../app/create/page";
import { getPostMediaError } from "../lib/postComposer";

const mocks = vi.hoisted(() => ({ createURL: vi.fn(() => "blob:preview"), revokeURL: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../hooks/useRequireAuth", () => ({
  useRequireAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: { items: [] }, isLoading: false, isError: false }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: mocks.createURL });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: mocks.revokeURL });
});
function mount() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CreatePostPage />
    </QueryClientProvider>,
  );
}
const image = () => new File(["image"], "art.png", { type: "image/png" });
const video = () => new File(["video"], "clip.mp4", { type: "video/mp4" });

describe("create post media", () => {
  it("previews device images and releases their URLs when removed", () => {
    mount();
    fireEvent.change(screen.getByLabelText("Add media"), { target: { files: [image()] } });
    expect(screen.getByAltText("Preview art.png")).toHaveAttribute("src", "blob:preview");
    fireEvent.click(screen.getByRole("button", { name: "Remove art.png" }));
    expect(screen.queryByAltText("Preview art.png")).not.toBeInTheDocument();
    expect(mocks.revokeURL).toHaveBeenCalledWith("blob:preview");
  });

  it("accepts a dropped video with playback controls and cleans up on unmount", () => {
    const { unmount } = mount();
    fireEvent.drop(screen.getByRole("region", { name: "Post media" }), {
      dataTransfer: { files: [video()] },
    });
    expect(screen.getByLabelText("Preview clip.mp4")).toHaveAttribute("controls");
    unmount();
    expect(mocks.revokeURL).toHaveBeenCalledWith("blob:preview");
  });

  it("rejects dropped mixed media without removing the existing image", () => {
    mount();
    fireEvent.change(screen.getByLabelText("Add media"), { target: { files: [image()] } });
    fireEvent.drop(screen.getByRole("region", { name: "Post media" }), {
      dataTransfer: { files: [video()] },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("cannot be mixed");
    expect(screen.getByAltText("Preview art.png")).toBeInTheDocument();
    expect(screen.queryByLabelText("Preview clip.mp4")).not.toBeInTheDocument();
  });

  it("enforces supported types, counts and exact size limits", () => {
    expect(getPostMediaError([new File(["text"], "notes.txt", { type: "text/plain" })])).toMatch(
      /not a supported/,
    );
    expect(getPostMediaError(Array.from({ length: 11 }, image))).toMatch(/up to 10/);
    expect(getPostMediaError([video(), video()])).toMatch(/one video/);
    for (const [type, limit] of [
      ["image/png", 10],
      ["video/mp4", 50],
    ] as const) {
      const file = new File([], "media", { type });
      Object.defineProperty(file, "size", { value: limit * 1024 * 1024, configurable: true });
      expect(getPostMediaError([file])).toBe("");
      Object.defineProperty(file, "size", { value: limit * 1024 * 1024 + 1 });
      expect(getPostMediaError([file])).toMatch(/exceeds/);
    }
  });
});
