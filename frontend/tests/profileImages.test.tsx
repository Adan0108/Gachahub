import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AvatarEditor } from "../components/profile/AvatarEditor";
import { BannerPicker } from "../components/profile/BannerPicker";
import { EditProfileDialog } from "../components/profile/EditProfileDialog";
import { queryKeys } from "../lib/queries";

const mocks = vi.hoisted(() => ({
  uploadSingleImage: vi.fn(),
  updateAvatar: vi.fn(),
  removeAvatar: vi.fn(),
  getBannerOptions: vi.fn(),
  updateBanner: vi.fn(),
  removeBanner: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: mocks,
  fallbackCategories: vi.fn(() => []),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(() => ({ items: [] })),
  fallbackPosts: vi.fn(() => []),
}));

const banners = [
  { id: "violet", label: "Violet", tier: "FREE", available: true },
  { id: "rose", label: "Rose", tier: "FREE", available: true },
  { id: "gilded", label: "Gilded", tier: "PREMIUM", available: false },
];
const me = { id: "user-1", name: "Rover", username: "rover", bio: "", image: "https://cdn/old.png", bannerPresetId: "violet" };

let client: QueryClient;

function renderWithClient(ui: import("react").ReactNode) {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(queryKeys.currentUser, me);
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const png = () => new File([new Uint8Array(10)], "me.png", { type: "image/png" });
const pickPicture = (file: File = png()) =>
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
const saveButton = () => screen.getByRole("button", { name: /Save changes|Uploading picture|Saving/ });

beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  mocks.getBannerOptions.mockResolvedValue(banners);
});

describe("AvatarEditor", () => {
  it("uploads a picked picture and reports it as a change, without setting it as the picture", async () => {
    mocks.uploadSingleImage.mockResolvedValue({ mediaUploadId: "upload-1" });
    const onChange = vi.fn();
    renderWithClient(<AvatarEditor change={{ kind: "keep" }} onChange={onChange} user={me} />);

    pickPicture();

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ kind: "upload", mediaUploadId: "upload-1" })),
    );
    expect(mocks.updateAvatar).not.toHaveBeenCalled();
  });

  it("offers Upload and no Remove when there is no picture", () => {
    renderWithClient(<AvatarEditor change={{ kind: "keep" }} onChange={vi.fn()} user={{ ...me, image: null }} />);

    expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("Remove only marks the picture to go, and Undo takes that back", () => {
    const onChange = vi.fn();
    const { rerender } = renderWithClient(<AvatarEditor change={{ kind: "keep" }} onChange={onChange} user={me} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onChange).toHaveBeenCalledWith({ kind: "remove" });
    expect(mocks.removeAvatar).not.toHaveBeenCalled();

    rerender(
      <QueryClientProvider client={client}>
        <AvatarEditor change={{ kind: "remove" }} onChange={onChange} user={me} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: "keep" });
  });

  it("rejects an unsupported file before uploading", async () => {
    renderWithClient(<AvatarEditor change={{ kind: "keep" }} onChange={vi.fn()} user={me} />);

    pickPicture(new File(["x"], "a.pdf", { type: "application/pdf" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/jpg, png, webp or gif/i);
    expect(mocks.uploadSingleImage).not.toHaveBeenCalled();
  });
});

describe("BannerPicker", () => {
  it("lists designs, marks the chosen one, and locks unavailable ones", async () => {
    renderWithClient(<BannerPicker onChange={vi.fn()} value="violet" />);

    expect(await screen.findByRole("radio", { name: "Violet" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Gilded" })).toBeDisabled();
  });

  it("reports a picked design or the default, and saves nothing itself", async () => {
    const onChange = vi.fn();
    renderWithClient(<BannerPicker onChange={onChange} value="violet" />);

    fireEvent.click(await screen.findByRole("radio", { name: "Rose" }));
    fireEvent.click(screen.getByRole("button", { name: /reset to default/i }));

    expect(onChange.mock.calls).toEqual([["rose"], [null]]);
    expect(mocks.updateBanner).not.toHaveBeenCalled();
    expect(mocks.removeBanner).not.toHaveBeenCalled();
  });

  it("shows an error instead of an empty grid when the catalog fails to load", async () => {
    mocks.getBannerOptions.mockRejectedValue(new Error("down"));
    renderWithClient(<BannerPicker onChange={vi.fn()} value={null} />);

    // the query retries once (retry: 1) before surfacing the error
    expect(await screen.findByRole("alert", {}, { timeout: 4000 })).toHaveTextContent(/could not load banners/i);
  });
});

describe("EditProfileDialog picture and banner", () => {
  const openDialog = () => {
    const onClose = vi.fn();
    renderWithClient(<EditProfileDialog onClose={onClose} user={me} />);
    return onClose;
  };

  it("saves a new picture and banner only when Save changes is pressed", async () => {
    mocks.uploadSingleImage.mockResolvedValue({ mediaUploadId: "upload-1" });
    mocks.updateAvatar.mockResolvedValue({ id: "user-1", image: "https://cdn/new.png" });
    mocks.updateBanner.mockResolvedValue({ id: "user-1", bannerPresetId: "rose" });
    const onClose = openDialog();

    pickPicture();
    fireEvent.click(await screen.findByRole("radio", { name: "Rose" }));
    await waitFor(() => expect(saveButton()).toHaveTextContent("Save changes"));
    expect(mocks.updateAvatar).not.toHaveBeenCalled();
    expect(mocks.updateBanner).not.toHaveBeenCalled();

    fireEvent.click(saveButton());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.updateAvatar).toHaveBeenCalledWith("upload-1");
    expect(mocks.updateBanner).toHaveBeenCalledWith("rose");
    expect(mocks.updateProfile).not.toHaveBeenCalled();
    expect(client.getQueryData(queryKeys.currentUser)).toMatchObject({
      image: "https://cdn/new.png",
      bannerPresetId: "rose",
    });
  });

  it("keeps Save greyed out while the picture uploads", async () => {
    let finish!: (value: { mediaUploadId: string }) => void;
    mocks.uploadSingleImage.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    openDialog();

    pickPicture();

    await waitFor(() => expect(saveButton()).toHaveTextContent("Uploading picture..."));
    expect(saveButton()).toBeDisabled();
    await act(async () => finish({ mediaUploadId: "upload-1" }));
    expect(saveButton()).toBeEnabled();
  });

  it("changes nothing when closed without saving", async () => {
    mocks.uploadSingleImage.mockResolvedValue({ mediaUploadId: "upload-1" });
    const onClose = openDialog();

    pickPicture();
    fireEvent.click(await screen.findByRole("radio", { name: "Rose" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Close edit profile" }));

    expect(onClose).toHaveBeenCalled();
    expect(mocks.updateAvatar).not.toHaveBeenCalled();
    expect(mocks.removeAvatar).not.toHaveBeenCalled();
    expect(mocks.updateBanner).not.toHaveBeenCalled();
    expect(client.getQueryData(queryKeys.currentUser)).toEqual(me);
  });

  it("removes the picture on Save", async () => {
    mocks.removeAvatar.mockResolvedValue({ id: "user-1", image: null });
    const onClose = openDialog();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.removeAvatar).toHaveBeenCalled();
  });
});
