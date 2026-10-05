// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queries";
import { useCommunityMembership } from "./useCommunityMembership";
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const cleanups: Array<() => void> = [];
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
  });
}
function setup(userId = "user-a") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let latest: ReturnType<typeof useCommunityMembership>;
  function Harness({ userId }: { userId: string }) {
    latest = useCommunityMembership("wuwa", userId);
    return createElement(
      "button",
      {
        onClick: latest.toggle,
        disabled: latest.isPending || latest.isLoading,
        "aria-pressed": latest.joined,
      },
      latest.joined ? "Joined" : "Join",
    );
  }
  const render = async (userId: string) => {
    await act(async () =>
      root.render(
        createElement(QueryClientProvider, { client }, createElement(Harness, { userId })),
      ),
    );
    await flush();
  };
  cleanups.push(() => {
    act(() => root.unmount());
    client.clear();
    container.remove();
  });
  return {
    client,
    container,
    render,
    userId,
    get value() {
      return latest!;
    },
  };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  push.mockClear();
  localStorage.clear();
});
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("server-backed community membership", () => {
  it("ignores legacy storage, joins/leaves, updates UI and invalidates counts/list", async () => {
    localStorage.setItem("gachahub-joined-communities", JSON.stringify(["wuwa"]));
    let joined = false;
    vi.spyOn(api, "getGameJoinStatus").mockImplementation(async () => ({ joined }));
    const join = vi.spyOn(api, "joinGame").mockImplementation(async () => {
      joined = true;
      return { joined };
    });
    const leave = vi.spyOn(api, "leaveGame").mockImplementation(async () => {
      joined = false;
      return { joined };
    });
    const hook = setup();
    const invalidation = vi.spyOn(hook.client, "invalidateQueries");
    await hook.render("user-a");
    expect(hook.value.joined).toBe(false);
    await act(async () => hook.value.toggle());
    await flush();
    expect(join).toHaveBeenCalledWith("wuwa");
    expect(hook.container.textContent).toBe("Joined");
    expect(invalidation).toHaveBeenCalledWith({
      queryKey: queryKeys.joinedGames("user-a"),
      exact: true,
    });
    expect(invalidation).toHaveBeenCalledWith({
      queryKey: queryKeys.community("wuwa"),
      exact: true,
    });
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ["games"] });
    await act(async () => hook.value.toggle());
    await flush();
    expect(leave).toHaveBeenCalledWith("wuwa");
    expect(hook.container.textContent).toBe("Join");
  });
  it("guards duplicate clicks while a mutation is pending", async () => {
    let joined = false;
    vi.spyOn(api, "getGameJoinStatus").mockImplementation(async () => ({ joined }));
    let finish!: (value: { joined: boolean }) => void;
    const join = vi.spyOn(api, "joinGame").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const hook = setup();
    await hook.render("user-a");
    await act(async () => {
      hook.value.toggle();
      hook.value.toggle();
    });
    await flush();
    expect(join).toHaveBeenCalledTimes(1);
    expect(hook.container.querySelector("button")?.disabled).toBe(true);
    await act(async () => {
      joined = true;
      finish({ joined: true });
    });
    await flush();
    expect(hook.value.joined).toBe(true);
  });
  it("keeps server state on API failure", async () => {
    vi.spyOn(api, "getGameJoinStatus").mockResolvedValue({ joined: true });
    vi.spyOn(api, "leaveGame").mockRejectedValue(new Error("offline"));
    const hook = setup();
    await hook.render("user-a");
    await act(async () => hook.value.toggle());
    await flush();
    expect(hook.value.joined).toBe(true);
    expect(hook.value.isError).toBe(true);
    expect(hook.value.error?.message).toBe("offline");
  });
  it("does not leak membership or an old mutation into another account", async () => {
    vi.spyOn(api, "getGameJoinStatus").mockResolvedValue({ joined: false });
    let finish!: (value: { joined: boolean }) => void;
    vi.spyOn(api, "joinGame").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const hook = setup();
    await hook.render("user-a");
    await act(async () => hook.value.toggle());
    await flush();
    await hook.render("user-b");
    await act(async () => finish({ joined: true }));
    await flush();
    expect(hook.value.joined).toBe(false);
    expect(hook.client.getQueryData(queryKeys.gameJoinStatus("wuwa", "user-b"))).toEqual({
      joined: false,
    });
    await hook.render("");
    expect(hook.value.joined).toBe(false);
  });
  it("redirects unauthenticated users without writing local membership", async () => {
    const status = vi.spyOn(api, "getGameJoinStatus");
    const join = vi.spyOn(api, "joinGame");
    const hook = setup("");
    await hook.render("");
    await act(async () => hook.value.toggle());
    expect(push).toHaveBeenCalledWith("/login");
    expect(status).not.toHaveBeenCalled();
    expect(join).not.toHaveBeenCalled();
    expect(localStorage.getItem("gachahub-joined-communities")).toBeNull();
  });
});
