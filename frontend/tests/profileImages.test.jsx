import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AvatarEditor } from "../components/profile/AvatarEditor";
import { BannerPicker } from "../components/profile/BannerPicker";
import { queryKeys } from "../lib/queries";

const mocks = vi.hoisted(() => ({
  uploadSingleImage: vi.fn(),
  updateAvatar: vi.fn(),
  removeAvatar: vi.fn(),
  getBannerOptions: vi.fn(),
  updateBanner: vi.fn(),
  removeBanner: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: mocks,
  fallbackCategories: vi.fn(() => []),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(() => ({ items: [] })),
  fallbackPosts: vi.fn(() => []),
}));

const banners = [
  { id: "violet-dusk", label: "Violet Dusk", tier: "FREE", available: true },
  { id: "gilded", label: "Gilded", tier: "PREMIUM", available: false },
];

let client;

function renderWithClient(ui) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(queryKeys.currentUser, { id: "user-1", name: "Rover", image: null });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const png = () => new File([new Uint8Array(10)], "me.png", { type: "image/png" });

describe("AvatarEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
  });

  it("uploads a picture, saves it, and writes the updated user into the cache", async () => {
    mocks.uploadSingleImage.mockResolvedValue({ mediaUploadId: "upload-1" });
    mocks.updateAvatar.mockResolvedValue({ id: "user-1", image: "https://cdn/me.png" });
    renderWithClient(<AvatarEditor user={{ id: "user-1", name: "Rover", image: null }} />);

    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [png()] } });

    await waitFor(() =>
      expect(client.getQueryData(queryKeys.currentUser)).toMatchObject({
        name: "Rover",
        image: "https://cdn/me.png",
      }),
    );
    expect(mocks.uploadSingleImage).toHaveBeenCalledWith(expect.any(File), "AVATAR");
    expect(mocks.updateAvatar).toHaveBeenCalledWith("upload-1");
  });

  it("offers Upload and no Remove when there is no picture", () => {
    renderWithClient(<AvatarEditor user={{ id: "user-1", name: "Rover", image: null }} />);

    expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("removes the picture and updates the cache", async () => {
    mocks.removeAvatar.mockResolvedValue({ id: "user-1", image: null });
    renderWithClient(
      <AvatarEditor user={{ id: "user-1", name: "Rover", image: "https://cdn/me.png" }} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(mocks.removeAvatar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete picture" }));

    await waitFor(() => expect(client.getQueryData(queryKeys.currentUser).image).toBeNull());
  });

  it("does not delete anything when the user keeps the picture", () => {
    renderWithClient(
      <AvatarEditor user={{ id: "user-1", name: "Rover", image: "https://cdn/me.png" }} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));

    expect(mocks.removeAvatar).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("shows the error when removal fails", async () => {
    mocks.removeAvatar.mockRejectedValue(new Error("Your avatar was changed elsewhere"));
    renderWithClient(
      <AvatarEditor user={{ id: "user-1", name: "Rover", image: "https://cdn/me.png" }} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete picture" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("changed elsewhere");
  });

  it("rejects an unsupported file before uploading", async () => {
    renderWithClient(<AvatarEditor user={{ id: "user-1", name: "Rover", image: null }} />);

    fireEvent.change(document.querySelector('input[type="file"]'), {
      target: { files: [new File(["x"], "a.pdf", { type: "application/pdf" })] },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(/jpg, png, webp or gif/i);
    expect(mocks.uploadSingleImage).not.toHaveBeenCalled();
  });
});

describe("BannerPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBannerOptions.mockResolvedValue(banners);
  });

  it("lists designs, marks the current one, and locks unavailable ones", async () => {
    renderWithClient(<BannerPicker currentId="violet-dusk" />);

    const free = await screen.findByRole("radio", { name: /violet dusk/i });
    expect(free).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /gilded/i })).toBeDisabled();
  });

  it("saves the picked design into the cache", async () => {
    mocks.updateBanner.mockResolvedValue({ id: "user-1", bannerPresetId: "violet-dusk" });
    renderWithClient(<BannerPicker currentId={null} />);

    fireEvent.click(await screen.findByRole("radio", { name: /violet dusk/i }));

    await waitFor(() =>
      expect(client.getQueryData(queryKeys.currentUser).bannerPresetId).toBe("violet-dusk"),
    );
    expect(mocks.updateBanner.mock.calls[0][0]).toBe("violet-dusk");
  });

  it("only offers 'Use default' when a banner is set, and clears it", async () => {
    mocks.removeBanner.mockResolvedValue({ id: "user-1", bannerPresetId: null });
    const { unmount } = renderWithClient(<BannerPicker currentId={null} />);
    await screen.findByRole("radio", { name: /violet dusk/i });
    expect(screen.queryByRole("button", { name: /use default/i })).not.toBeInTheDocument();
    unmount();

    renderWithClient(<BannerPicker currentId="violet-dusk" />);
    fireEvent.click(await screen.findByRole("button", { name: /use default/i }));

    await waitFor(() => expect(client.getQueryData(queryKeys.currentUser).bannerPresetId).toBeNull());
  });

  it("shows the server's message when saving is refused", async () => {
    mocks.updateBanner.mockRejectedValue(new Error("This banner is not available to you yet"));
    renderWithClient(<BannerPicker currentId={null} />);

    fireEvent.click(await screen.findByRole("radio", { name: /violet dusk/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("not available");
  });

  it("shows an error instead of an empty grid when the catalog fails to load", async () => {
    mocks.getBannerOptions.mockRejectedValue(new Error("down"));
    renderWithClient(<BannerPicker currentId={null} />);

    // the query retries once (retry: 1) before surfacing the error
    expect(await screen.findByRole("alert", {}, { timeout: 4000 })).toHaveTextContent(
      /could not load banners/i,
    );
  });
});
