import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LinkPreviewTray } from "../components/chat/LinkPreviewTray";

const preview = {
  url: "https://example.com/post",
  domain: "example.com",
  resolvedDomain: null,
  title: "A post",
  description: null,
  image: null,
};

describe("LinkPreviewTray", () => {
  it("shows nothing when there is no link", () => {
    const { container } = render(<LinkPreviewTray isLoading={false} onDismiss={() => {}} preview={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows a placeholder while the card loads", () => {
    render(<LinkPreviewTray isLoading onDismiss={() => {}} preview={null} />);

    expect(screen.getByRole("status", { name: "Loading link preview" })).toBeInTheDocument();
  });

  it("shows the card, and removes it on request", () => {
    const onDismiss = vi.fn();
    render(<LinkPreviewTray isLoading={false} onDismiss={onDismiss} preview={preview} />);

    expect(screen.getByText("A post")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove link preview" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("shows the card rather than the placeholder once it has arrived", () => {
    render(<LinkPreviewTray isLoading onDismiss={() => {}} preview={preview} />);

    expect(screen.getByText("A post")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not turn the card into a link, so a click in the composer never leaves the page", () => {
    render(<LinkPreviewTray isLoading={false} onDismiss={() => {}} preview={preview} />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
