import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReadReceiptsSetting } from "../components/settings/ReadReceiptsSetting";
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
      <ReadReceiptsSetting />
    </QueryClientProvider>,
  );
  return { client };
}

const toggle = () => screen.getByRole("switch", { name: "Read receipts" });

describe("ReadReceiptsSetting", () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockReset();
    mocks.updateProfile.mockReset().mockResolvedValue({});
  });

  it("is on for someone who never changed it", () => {
    setup({ id: "me" });

    expect(toggle()).toBeChecked();
  });

  it("reflects the saved setting", () => {
    setup({ id: "me", sendReadReceipts: false });

    expect(toggle()).not.toBeChecked();
  });

  it("explains what it does, and that delivery still shows", () => {
    setup({ id: "me", sendReadReceipts: true });

    expect(screen.getByText(/neither works/)).toBeInTheDocument();
    expect(screen.getByText(/still shows either way/)).toBeInTheDocument();
  });

  it("saves the new value as soon as it is flipped, and shows it at once", async () => {
    const { client } = setup({ id: "me", sendReadReceipts: true });
    mocks.getCurrentUser.mockResolvedValue({ id: "me", sendReadReceipts: false });

    fireEvent.click(toggle());

    await waitFor(() => expect(mocks.updateProfile).toHaveBeenCalledWith({ sendReadReceipts: false }));
    await waitFor(() => expect(toggle()).not.toBeChecked());
    expect(client.getQueryData(queryKeys.currentUser).sendReadReceipts).toBe(false);
  });

  it("can be turned back on", async () => {
    setup({ id: "me", sendReadReceipts: false });
    mocks.getCurrentUser.mockResolvedValue({ id: "me", sendReadReceipts: true });

    fireEvent.click(toggle());

    await waitFor(() => expect(mocks.updateProfile).toHaveBeenCalledWith({ sendReadReceipts: true }));
    await waitFor(() => expect(toggle()).toBeChecked());
  });

  it("puts the switch back and says so when saving fails", async () => {
    mocks.updateProfile.mockRejectedValue(new Error("offline"));
    setup({ id: "me", sendReadReceipts: true });

    fireEvent.click(toggle());

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save that. Try again.");
    await waitFor(() => expect(toggle()).toBeChecked());
  });

  it("clears an old error on the next try", async () => {
    mocks.updateProfile.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({});
    setup({ id: "me", sendReadReceipts: true });
    fireEvent.click(toggle());
    await screen.findByRole("alert");

    fireEvent.click(toggle());

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("cannot be flipped before the account has loaded", () => {
    mocks.getCurrentUser.mockReturnValue(new Promise(() => {}));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ReadReceiptsSetting />
      </QueryClientProvider>,
    );

    expect(toggle()).toBeDisabled();
  });
});
