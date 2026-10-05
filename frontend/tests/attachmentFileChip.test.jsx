import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttachmentFileChip } from "../components/chat/AttachmentFileChip";

const mocks = vi.hoisted(() => ({ saveAttachment: vi.fn() }));

vi.mock("../lib/mls/media/saveAttachment", () => ({ saveAttachment: mocks.saveAttachment }));

const file = { name: "260928_D.Capitale_TB.pdf", size: 268_000 };
const source = { id: "blob-1" };

describe("AttachmentFileChip", () => {
  beforeEach(() => {
    mocks.saveAttachment.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("is a single card with the name, size and type, and no Download button", () => {
    const { container } = render(<AttachmentFileChip file={file} source={source} />);

    const card = screen.getByRole("button", { name: /260928_D\.Capitale_TB\.pdf/ });
    expect(card).toHaveTextContent("PDF");
    expect(card).toHaveTextContent("KB");
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(screen.queryByText("Download")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("saves the file when the card is clicked", async () => {
    render(<AttachmentFileChip file={file} source={source} />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(mocks.saveAttachment).toHaveBeenCalledWith(source, file.name));
  });

  it("shows Decrypting... and ignores extra clicks while it works", async () => {
    let finish;
    mocks.saveAttachment.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<AttachmentFileChip file={file} source={source} />);

    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText("Decrypting...")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeDisabled();
    fireEvent.click(screen.getByRole("button"));
    expect(mocks.saveAttachment).toHaveBeenCalledTimes(1);

    finish();
    await waitFor(() => expect(screen.queryByText("Decrypting...")).not.toBeInTheDocument());
  });

  it("reports an unavailable file after a failure and lets you try again", async () => {
    mocks.saveAttachment.mockRejectedValueOnce(new Error("gone"));
    render(<AttachmentFileChip file={file} source={source} />);

    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText("File unavailable")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(mocks.saveAttachment).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("File unavailable")).not.toBeInTheDocument());
  });

  it("is not clickable when the file has no source", () => {
    render(<AttachmentFileChip file={file} source={null} />);

    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByText("File unavailable")).toBeInTheDocument();
  });
});
