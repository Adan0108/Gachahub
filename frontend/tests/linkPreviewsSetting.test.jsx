import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LinkPreviewsSetting } from "../components/settings/LinkPreviewsSetting";
import { queryKeys } from "../lib/queries";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), updateProfile: vi.fn() }));

vi.mock("../lib/api", () => ({
  API_BASE_URL: "http://localhost:3000",
  api: { getCurrentUser: mocks.getCurrentUser, updateProfile: mocks.updateProfile },
  fallbackCategories: vi.fn(() => []),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(() => ({ items: [] })),
  fallbackPosts: vi.fn(() => []),
}));

function setup(user) {
  mocks.getCurrentUser.mockResolvedValue(user);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.currentUser, user);
  render(
    <QueryClientProvider client={client}>
      <LinkPreviewsSetting />
    </QueryClientProvider>,
  );
  return { client };
}

const toggle = () => screen.getByRole("switch", { name: "Link previews" });

describe("LinkPreviewsSetting", () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockReset();
    mocks.updateProfile.mockReset().mockResolvedValue({});
  });

  it("is on for someone who never changed it", () => {
    setup({ id: "me" });

    expect(toggle()).toBeChecked();
  });

  it("reflects the saved setting", () => {
    setup({ id: "me", sendLinkPreviews: false });

    expect(toggle()).not.toBeChecked();
  });

  it("says that the server loads the page, and that links you receive are not affected", () => {
    setup({ id: "me", sendLinkPreviews: true });

    expect(screen.getByText(/server loads the page/)).toBeInTheDocument();
    expect(screen.getByText(/other people send you are not affected/)).toBeInTheDocument();
  });

  it("saves the new value as soon as it is flipped, and shows it at once", async () => {
    setup({ id: "me", sendLinkPreviews: true });
    mocks.getCurrentUser.mockResolvedValue({ id: "me", sendLinkPreviews: false });

    fireEvent.click(toggle());

    await waitFor(() => expect(toggle()).not.toBeChecked());
    await waitFor(() => expect(mocks.updateProfile).toHaveBeenCalledWith({ sendLinkPreviews: false }));
  });

  it("changes only this setting, not the read receipts one", async () => {
    setup({ id: "me", sendLinkPreviews: false, sendReadReceipts: true });
    mocks.getCurrentUser.mockResolvedValue({ id: "me", sendLinkPreviews: true, sendReadReceipts: true });

    fireEvent.click(toggle());

    await waitFor(() => expect(mocks.updateProfile).toHaveBeenCalledTimes(1));
    expect(mocks.updateProfile).toHaveBeenCalledWith({ sendLinkPreviews: true });
  });

  it("puts the switch back and says so when saving fails", async () => {
    mocks.updateProfile.mockRejectedValue(new Error("offline"));
    setup({ id: "me", sendLinkPreviews: true });

    fireEvent.click(toggle());

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save that. Try again.");
    await waitFor(() => expect(toggle()).toBeChecked());
  });

  it("is not usable until the profile has loaded", () => {
    mocks.getCurrentUser.mockReturnValue(new Promise(() => {}));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <LinkPreviewsSetting />
      </QueryClientProvider>,
    );

    expect(toggle()).toBeDisabled();
  });
});
