import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GroupPhotoEditor } from "../components/chat/GroupPhotoEditor";

const mocks = vi.hoisted(() => ({
  uploadSingleImage: vi.fn(),
  setGroupPhoto: vi.fn(),
  removeGroupPhoto: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: mocks,
  fallbackCategories: vi.fn(() => []),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(() => ({ items: [] })),
  fallbackPosts: vi.fn(() => []),
}));

const image = (name = "pic.png", type = "image/png") => new File(["x"], name, { type });

function setup(props = {}) {
  const onChanged = vi.fn();
  const view = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <GroupPhotoEditor conversationId="g1" name="Squad" onChanged={onChanged} photoUrl={null} {...props} />
    </QueryClientProvider>,
  );
  return { onChanged, ...view };
}

const fileInput = () => document.querySelector('input[type="file"]');

describe("GroupPhotoEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    mocks.uploadSingleImage.mockResolvedValue({ mediaUploadId: "up1", secureUrl: "https://res.cloudinary.com/x/up1.png" });
    mocks.setGroupPhoto.mockResolvedValue({ id: "g1", photoUrl: "https://res.cloudinary.com/x/up1.png" });
    mocks.removeGroupPhoto.mockResolvedValue({ id: "g1", photoUrl: null });
  });

  it("offers Upload, and no Remove, when the group has no photo", () => {
    setup();

    expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("uploads the chosen file and saves it as the group photo", async () => {
    const { onChanged } = setup();

    fireEvent.change(fileInput(), { target: { files: [image()] } });

    await waitFor(() => expect(mocks.setGroupPhoto).toHaveBeenCalledWith("g1", "up1"));
    expect(mocks.uploadSingleImage).toHaveBeenCalledWith(expect.any(File), "GROUP_PHOTO");
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("takes a dropped file the same way", async () => {
    setup();
    const drop = document.querySelector(".group-photo-drop");

    fireEvent.drop(drop, { dataTransfer: { files: [image("dropped.png")] } });

    await waitFor(() => expect(mocks.setGroupPhoto).toHaveBeenCalledWith("g1", "up1"));
  });

  it("refuses a file that is not an image, with a clear message and no upload", async () => {
    setup();

    fireEvent.change(fileInput(), { target: { files: [image("notes.pdf", "application/pdf")] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("JPG, PNG, WebP or GIF");
    expect(mocks.uploadSingleImage).not.toHaveBeenCalled();
  });

  it("shows Replace and Remove for a group that has a photo, and removes it", async () => {
    const { onChanged } = setup({ photoUrl: "https://res.cloudinary.com/x/old.png" });

    expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(mocks.removeGroupPhoto).toHaveBeenCalledWith("g1"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("says so when removing fails", async () => {
    mocks.removeGroupPhoto.mockRejectedValue(new Error("Could not remove it"));
    setup({ photoUrl: "https://res.cloudinary.com/x/old.png" });

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not remove it");
  });
});
