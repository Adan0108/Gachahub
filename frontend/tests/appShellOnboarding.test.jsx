import "@testing-library/jest-dom/vitest";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../components/AppShell";

const mocks = vi.hoisted(() => ({ replace: vi.fn() }));

let pathname = "/";
let currentUser = { user: null, isAuthenticated: false, isLoading: false };

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => currentUser,
}));
vi.mock("../hooks/useTheme", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: vi.fn() }),
}));
vi.mock("../hooks/chat/useDeviceIdentity", () => ({
  useDeviceIdentity: () => undefined,
}));
vi.mock("../hooks/chat/useChatSocket", () => ({
  useChatSocket: () => undefined,
}));
vi.mock("../hooks/useAppSocket", () => ({ useAppSocket: () => undefined }));
vi.mock("../hooks/useNotificationSocket", () => ({ useNotificationSocket: () => undefined }));
vi.mock("../components/Topbar", () => ({ Topbar: () => null }));
vi.mock("../components/DevToolsPanel", () => ({ DevToolsPanel: () => null }));

function renderShell() {
  return render(
    <AppShell>
      <div>page content</div>
    </AppShell>,
  );
}

describe("AppShell onboarding gate", () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    pathname = "/";
    currentUser = { user: null, isAuthenticated: false, isLoading: false };
  });

  it("does not redirect while the session is still loading", () => {
    currentUser = { user: null, isAuthenticated: false, isLoading: true };
    renderShell();

    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("does not redirect an unauthenticated visitor", () => {
    currentUser = { user: null, isAuthenticated: false, isLoading: false };
    renderShell();

    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("does not redirect an authenticated, already-onboarded user", () => {
    currentUser = {
      user: { id: "u1", onboarded: true },
      isAuthenticated: true,
      isLoading: false,
    };
    renderShell();

    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("redirects an authenticated, not-yet-onboarded user to /onboarding", async () => {
    currentUser = {
      user: { id: "u1", onboarded: false },
      isAuthenticated: true,
      isLoading: false,
    };
    renderShell();

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/onboarding"));
  });

  it("does not loop when already on /onboarding", () => {
    pathname = "/onboarding";
    currentUser = {
      user: { id: "u1", onboarded: false },
      isAuthenticated: true,
      isLoading: false,
    };
    renderShell();

    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("does not redirect on /admin pages", () => {
    pathname = "/admin/users";
    currentUser = {
      user: { id: "u1", onboarded: false },
      isAuthenticated: true,
      isLoading: false,
    };
    renderShell();

    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
