import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import Page from "../app/admin/moderation/page";
import { api } from "../lib/api";
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/moderation" }));
vi.mock("../hooks/admin/useRequireAdmin", () => ({
  useRequireAdmin: () => ({ user: { id: "admin", role: "ADMIN" }, isAdmin: true }),
}));
beforeEach(() => {
  vi.spyOn(api, "listPlatformCases");
  vi.spyOn(api, "getAdminOverview").mockResolvedValue({
    metrics: [{ id: "reports", value: 42 }],
    moderation: { openCases: 12, unassignedCases: 5 },
  });
  vi.spyOn(api, "listAdminContent").mockResolvedValue({ items: [], meta: { total: 0 } });
});
it("links to cursor case queues without requesting totals and retains complaint metrics", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Page />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("42")).toBeInTheDocument();
  expect(screen.getByText("Open cases")).toBeInTheDocument();
  expect(api.listPlatformCases).not.toHaveBeenCalled();
  expect(screen.getByText("Open complaints")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open case queue" })).toHaveAttribute(
    "href",
    "/moderation/cases",
  );
  expect(api.listAdminContent).not.toHaveBeenCalled();
  expect(screen.queryByText("Flagged content")).not.toBeInTheDocument();
  expect(screen.getByText("Unassigned cases")).toBeVisible();
  expect(screen.getByText("12")).toBeVisible();
  expect(screen.getByText("5")).toBeVisible();
});
