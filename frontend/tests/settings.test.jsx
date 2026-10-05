import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "../app/settings/page";

vi.mock("../lib/api", () => ({
  api: { usingMocks: false },
}));

vi.mock("../lib/queries", () => ({
  fallbacks: { home: () => ({ communities: [] }) },
  queries: {
    home: () => ({
      queryKey: ["home"],
      queryFn: () => Promise.resolve({
        communities: [{ slug: "wuthering-waves", name: "Wuthering Waves" }],
      }),
    }),
  },
}));

function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

describe("SettingsPage", () => {
  beforeEach(() => window.localStorage.clear());

  it("saves feed preferences from the settings page", async () => {
    renderSettings();

    fireEvent.click(await screen.findByText("Wuthering Waves"));
    fireEvent.click(screen.getByText("Guide"));
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));

    expect(JSON.parse(window.localStorage.getItem("gachahub-feed-preferences"))).toEqual({
      games: ["wuthering-waves"],
      categories: ["Guide"],
    });
    expect(screen.getByText("Feed preferences saved")).toBeInTheDocument();
  });

  it("explains unfinished account controls", async () => {
    renderSettings();
    fireEvent.click(await screen.findByText("Email notifications"));
    expect(screen.getByText("This setting is not available yet")).toBeInTheDocument();
  });
});
