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
  vi.spyOn(api, "getAdminOverview").mockResolvedValue({ metrics: [{ id: "reports", value: 42 }] });
  vi.spyOn(api, "listAdminContent").mockResolvedValue({ items: [], meta: { total: 0 } });
});
it("links to cursor case queues without requesting totals and retains complaint metrics", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Page />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("42")).toBeInTheDocument();
  expect(screen.getByText("Review cases")).toBeInTheDocument();
  expect(api.listPlatformCases).not.toHaveBeenCalled();
  expect(screen.getByText("Open complaints")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open case queue" })).toHaveAttribute(
    "href",
    "/moderation/cases",
  );
  expect(api.listAdminContent).toHaveBeenCalledWith(
    expect.objectContaining({ excludeHidden: true }),
    expect.anything(),
  );
});
