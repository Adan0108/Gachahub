import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminShell } from "../components/admin/AdminShell";
import { AppShell } from "../components/AppShell";
import type { ComponentProps } from "react";
import type { Topbar } from "../components/Topbar";

const mocks = vi.hoisted(() => ({ pathname: "/explore", waiting: 0 }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: null, isAuthenticated: false, isLoading: false }),
}));
vi.mock("../hooks/useTheme", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: vi.fn() }),
}));
vi.mock("../hooks/chat/useDeviceIdentity", () => ({ useDeviceIdentity: vi.fn() }));
vi.mock("../hooks/chat/useChatSocket", () => ({ useChatSocket: vi.fn() }));
vi.mock("../hooks/chat/useWaitingChats", () => ({ useWaitingChats: () => mocks.waiting }));
vi.mock("../hooks/useAppSocket", () => ({ useAppSocket: vi.fn() }));
vi.mock("../hooks/useNotificationSocket", () => ({ useNotificationSocket: vi.fn() }));
vi.mock("../hooks/presence/usePresenceSocket", () => ({ usePresenceSocket: vi.fn() }));
vi.mock("../components/DevToolsPanel", () => ({ DevToolsPanel: () => null }));
vi.mock("../components/Topbar", () => ({
  Topbar: ({ onMenu, menuButtonRef }: ComponentProps<typeof Topbar>) => (
    <button onClick={onMenu} ref={menuButtonRef} type="button">
      Open menu
    </button>
  ),
}));

describe("AppShell navigation", () => {
  beforeEach(() => {
    mocks.pathname = "/explore";
    mocks.waiting = 0;
    document.body.style.overflow = "";
  });

  it("marks the current page and provides a skip link", () => {
    render(
      <AppShell>
        <p>Page content</p>
      </AppShell>,
    );

    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute(
      "href",
      "#main-content",
    );
    expect(document.querySelector("#main-content")).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("link", { name: /Explore/ })).toHaveAttribute("aria-current", "page");
  });

  it("shows a dot on Messages while chats or requests are waiting, and none when nothing is", () => {
    const shell = (
      <AppShell>
        <p>Page content</p>
      </AppShell>
    );
    const { rerender } = render(shell);
    expect(screen.queryByRole("img", { name: "Unread chats waiting" })).not.toBeInTheDocument();

    mocks.waiting = 3;
    rerender(shell);
    expect(screen.getByRole("link", { name: /Messages/ })).toContainElement(
      screen.getByRole("img", { name: "Unread chats waiting" }),
    );
  });

  it("locks background scrolling and closes the menu with Escape", () => {
    render(
      <AppShell>
        <p>Page content</p>
      </AppShell>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByRole("complementary", { name: "Primary navigation" })).toHaveClass("open");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.body.style.overflow).toBe("");
    expect(screen.getByRole("complementary", { name: "Primary navigation" })).not.toHaveClass(
      "open",
    );
  });
});

it("preserves the existing admin shell through queue, detail and back navigation", () => {
  const content = () => <AppShell><AdminShell user={{ role: "ADMIN", name: "Admin" }}><p>Review</p></AdminShell></AppShell>;
  mocks.pathname = "/admin/moderation";
  const page = render(content());
  for (const route of ["/moderation/cases", "/moderation/cases/case", "/admin/moderation"]) {
    mocks.pathname = route; page.rerender(content());
    expect(screen.getByRole("navigation", { name: "Admin navigation" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Primary navigation" })).not.toBeInTheDocument();
    if (route.startsWith("/moderation/cases")) expect(screen.getByRole("link", { name: "Cases" })).toHaveAttribute("aria-current", "page");
  }
});
