import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useSignOut } from "../hooks/useSignOut";
import { api } from "../lib/api";
import { moderationKeys } from "../lib/moderation";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("../lib/sessionCleanup", () => ({ runSessionCleanups: vi.fn().mockResolvedValue(undefined), registerSessionCleanup: vi.fn() }));
function Logout() {
  const logout = useSignOut();
  return <button onClick={() => logout.mutate()}>Sign out</button>;
}
it("sign-out cancels and removes sensitive moderation queries before navigation", async () => {
  vi.spyOn(api, "signOut").mockResolvedValue({});
  const client = new QueryClient();
  client.setQueryData(moderationKeys.detail("a", "", "case"), { evidence: "private" });
  render(<QueryClientProvider client={client}><Logout /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  expect(client.getQueriesData({ queryKey: ["moderation"] })).toEqual([]);
  expect(client.getQueryData(["current-user"])).toBeNull();
});
