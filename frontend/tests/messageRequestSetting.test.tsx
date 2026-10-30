import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageRequestSetting } from "../components/settings/MessageRequestSetting";
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

function setup(user: { id: string; messageRequestSetting?: string }) {
  mocks.getCurrentUser.mockResolvedValue(user);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.currentUser, user);
  render(
    <QueryClientProvider client={client}>
      <MessageRequestSetting />
    </QueryClientProvider>,
  );
}

const option = (name: string) => screen.getByRole("radio", { name: new RegExp(`^${name}`) });

describe("MessageRequestSetting", () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockReset();
    mocks.updateProfile.mockReset().mockResolvedValue({});
  });

  it("is Everyone for someone who never changed it", () => {
    setup({ id: "me" });

    expect(option("Everyone")).toBeChecked();
  });

  it("shows the saved choice", () => {
    setup({ id: "me", messageRequestSetting: "FOLLOWERS" });

    expect(option("People you follow")).toBeChecked();
    expect(option("Everyone")).not.toBeChecked();
  });

  it("says in plain words what each choice means", () => {
    setup({ id: "me" });

    expect(screen.getByText(/Anyone can send you a message request/)).toBeInTheDocument();
    expect(screen.getByText(/Only people you follow can send you a request/)).toBeInTheDocument();
    expect(screen.getByText(/Nobody can start a new chat with you/)).toBeInTheDocument();
  });

  it("saves the pick as soon as it is made, and keeps showing it after a reload", async () => {
    setup({ id: "me", messageRequestSetting: "EVERYONE" });
    mocks.getCurrentUser.mockResolvedValue({ id: "me", messageRequestSetting: "NO_ONE" });

    fireEvent.click(option("No one"));

    await waitFor(() =>
      expect(mocks.updateProfile).toHaveBeenCalledWith({ messageRequestSetting: "NO_ONE" }),
    );
    await waitFor(() => expect(option("No one")).toBeChecked());
  });

  it("puts the old choice back and says so when saving fails", async () => {
    mocks.updateProfile.mockRejectedValue(new Error("offline"));
    setup({ id: "me", messageRequestSetting: "EVERYONE" });

    fireEvent.click(option("No one"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save that. Try again.");
    await waitFor(() => expect(option("Everyone")).toBeChecked());
  });
});
