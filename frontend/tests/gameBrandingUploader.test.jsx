import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GameBrandingUploader } from "../components/admin/GameBrandingUploader";

const mocks = vi.hoisted(() => ({
  uploadSingleImage: vi.fn(),
  updateGameBranding: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: {
    uploadSingleImage: mocks.uploadSingleImage,
    updateGameBranding: mocks.updateGameBranding,
  },
}));

function renderUploader(props = {}) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GameBrandingUploader
        currentUrl="https://cdn/old.png"
        gameSlug="wuthering-waves"
        label="Icon"
        purpose="GAME_ICON"
        {...props}
      />
    </QueryClientProvider>,
  );
}

function pick(file) {
  const input = document.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [file] } });
}

const png = (size = 10) => new File([new Uint8Array(size)], "icon.png", { type: "image/png" });

describe("GameBrandingUploader", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
  });

  it("uploads, saves the confirmed id into the right field, and shows the new image", async () => {
    const onUpdated = vi.fn();
    mocks.uploadSingleImage.mockResolvedValue({ mediaUploadId: "upload-1" });
    mocks.updateGameBranding.mockResolvedValue({ iconUrl: "https://cdn/new.png" });
    renderUploader({ onUpdated });

    pick(png());

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith({ iconUrl: "https://cdn/new.png" }));
    expect(mocks.uploadSingleImage).toHaveBeenCalledWith(expect.any(File), "GAME_ICON");
    expect(mocks.updateGameBranding).toHaveBeenCalledWith("wuthering-waves", {
      iconMediaUploadId: "upload-1",
    });
    await waitFor(() =>
      expect(document.querySelector(".branding-uploader-preview img")).toHaveAttribute(
        "src",
        "https://cdn/new.png",
      ),
    );
  });

  it("rejects an unsupported file type without uploading", async () => {
    renderUploader();

    pick(new File(["x"], "doc.pdf", { type: "application/pdf" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/jpg, png, webp or gif/i);
    expect(mocks.uploadSingleImage).not.toHaveBeenCalled();
  });

  it("rejects an image over 10 MB without uploading", async () => {
    renderUploader();

    pick(png(10 * 1024 * 1024 + 1));

    expect(await screen.findByRole("alert")).toHaveTextContent(/10 mb/i);
    expect(mocks.uploadSingleImage).not.toHaveBeenCalled();
  });

  it("shows the error and keeps the old image when the save fails", async () => {
    mocks.uploadSingleImage.mockResolvedValue({ mediaUploadId: "upload-1" });
    mocks.updateGameBranding.mockRejectedValue(new Error("changed by someone else"));
    renderUploader();

    pick(png());

    expect(await screen.findByRole("alert")).toHaveTextContent("changed by someone else");
    expect(document.querySelector(".branding-uploader-preview img")).toHaveAttribute(
      "src",
      "https://cdn/old.png",
    );
  });
});
