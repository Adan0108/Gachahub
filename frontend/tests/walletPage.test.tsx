import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WalletPage from "../app/wallet/page";

const mocks = vi.hoisted(() => ({
  getWallet: vi.fn(),
  getWalletLedger: vi.fn(),
  checkIn: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: mocks,
  fallbackCategories: vi.fn(() => []),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(() => ({ items: [] })),
  fallbackPosts: vi.fn(() => []),
}));
vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "me" }, isAuthenticated: true, isLoading: false }),
}));

const entry = (id: string, reason: string) => ({
  id,
  currency: "SHARDS",
  delta: 1,
  balanceAfter: 1,
  reason,
  createdAt: "2026-10-29T10:00:00Z",
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WalletPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getWallet.mockResolvedValue({
    reputation: 12,
    shards: 40,
    prisms: 0,
    rank: "STARGAZER",
    reputation90d: 12,
    today: { shardsEarned: 5, shardCap: 60, checkedIn: false, resetsAt: "2026-10-30T17:00:00Z" },
  });
});

describe("Wallet page history", () => {
  it("loads older entries with Load more until there are none", async () => {
    mocks.getWalletLedger
      .mockResolvedValueOnce({ items: [entry("a", "COMMENT_WRITTEN")], nextCursor: "a" })
      .mockResolvedValueOnce({ items: [entry("b", "LIKE_MILESTONE")], nextCursor: null });
    renderPage();

    expect(await screen.findByText("Comment written")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("Like milestone")).toBeInTheDocument();
    expect(mocks.getWalletLedger).toHaveBeenLastCalledWith("a", expect.anything());
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });
});
