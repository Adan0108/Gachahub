import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../components/AppShell";

const mocks = vi.hoisted(() => ({ pathname: "/explore" }));

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
vi.mock("../components/DevToolsPanel", () => ({ DevToolsPanel: () => null }));
vi.mock("../components/Topbar", () => ({
  Topbar: ({ onMenu, menuButtonRef }) => (
    <button onClick={onMenu} ref={menuButtonRef} type="button">Open menu</button>
  ),
}));

describe("AppShell navigation", () => {
  beforeEach(() => {
    mocks.pathname = "/explore";
    document.body.style.overflow = "";
  });

  it("marks the current page and provides a skip link", () => {
    render(<AppShell><p>Page content</p></AppShell>);

    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute(
      "href",
      "#main-content",
    );
    expect(document.querySelector("#main-content")).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("link", { name: /Explore/ })).toHaveAttribute("aria-current", "page");
  });

  it("locks background scrolling and closes the menu with Escape", () => {
    render(<AppShell><p>Page content</p></AppShell>);

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByRole("complementary", { name: "Primary navigation" })).toHaveClass("open");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.body.style.overflow).toBe("");
    expect(screen.getByRole("complementary", { name: "Primary navigation" })).not.toHaveClass("open");
  });
});
