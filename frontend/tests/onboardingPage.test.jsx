import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OnboardingPage from "../app/onboarding/page";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  checkUsernameAvailable: vi.fn(),
  completeOnboarding: vi.fn(),
  signOut: vi.fn(),
  runSessionCleanups: vi.fn(),
}));

let session = { user: { id: "u1", onboarded: false }, isAuthenticated: true, isLoading: false };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
}));
vi.mock("../hooks/useRequireAuth", () => ({
  useRequireAuth: () => session,
}));
vi.mock("../lib/api", () => ({
  api: {
    checkUsernameAvailable: mocks.checkUsernameAvailable,
    completeOnboarding: mocks.completeOnboarding,
    signOut: mocks.signOut,
  },
  fallbackCategories: vi.fn(() => []),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(() => ({ items: [] })),
  fallbackPosts: vi.fn(() => []),
}));
vi.mock("../lib/sessionCleanup", () => ({
  runSessionCleanups: mocks.runSessionCleanups,
  registerSessionCleanup: vi.fn(),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OnboardingPage />
    </QueryClientProvider>,
  );
}

describe("OnboardingPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.replace.mockReset();
    mocks.push.mockReset();
    mocks.checkUsernameAvailable.mockReset().mockResolvedValue({ available: true });
    mocks.completeOnboarding.mockReset().mockResolvedValue({});
    mocks.signOut.mockReset().mockResolvedValue({});
    mocks.runSessionCleanups.mockReset().mockResolvedValue();
    session = { user: { id: "u1", onboarded: false }, isAuthenticated: true, isLoading: false };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("pre-fills the display name from what they already typed at signup", () => {
    session = {
      user: { id: "u1", onboarded: false, name: "Test Onboarder" },
      isAuthenticated: true,
      isLoading: false,
    };
    renderPage();

    expect(screen.getByPlaceholderText("Hertzy")).toHaveValue("Test Onboarder");
  });

  it("disables submit until a valid name and an available handle are entered", async () => {
    renderPage();

    const submit = screen.getByRole("button", { name: /continue/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("Hertzy"), {
      target: { value: "Rover" },
    });
    fireEvent.change(screen.getByPlaceholderText("Hertzy-123"), {
      target: { value: "Rover-123" },
    });

    await vi.advanceTimersByTimeAsync(500);
    await waitFor(() => expect(submit).not.toBeDisabled());
    expect(mocks.checkUsernameAvailable).toHaveBeenCalledWith("Rover-123");
  });

  it("shows an inline hint for an invalid handle without calling the backend", () => {
    renderPage();

    fireEvent.change(screen.getByPlaceholderText("Hertzy-123"), {
      target: { value: "a" },
    });

    expect(screen.getByText(/letters, digits/i)).toBeInTheDocument();
    expect(mocks.checkUsernameAvailable).not.toHaveBeenCalled();
  });

  it("shows taken and keeps submit disabled when the handle is not available", async () => {
    mocks.checkUsernameAvailable.mockResolvedValue({ available: false });
    renderPage();

    fireEvent.change(screen.getByPlaceholderText("Hertzy"), {
      target: { value: "Rover" },
    });
    fireEvent.change(screen.getByPlaceholderText("Hertzy-123"), {
      target: { value: "Rover-123" },
    });

    await vi.advanceTimersByTimeAsync(500);
    await waitFor(() => expect(screen.getByText(/already taken/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });

  it("submits and redirects home on success", async () => {
    renderPage();

    fireEvent.change(screen.getByPlaceholderText("Hertzy"), {
      target: { value: "Rover" },
    });
    fireEvent.change(screen.getByPlaceholderText("Hertzy-123"), {
      target: { value: "Rover-123" },
    });
    await vi.advanceTimersByTimeAsync(500);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /continue/i })).not.toBeDisabled(),
    );

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
    expect(mocks.completeOnboarding).toHaveBeenCalledWith({
      name: "Rover",
      username: "Rover-123",
    });
  });

  it("shows the server error on a conflict instead of redirecting", async () => {
    mocks.completeOnboarding.mockRejectedValue(new Error("That handle is taken"));
    renderPage();

    fireEvent.change(screen.getByPlaceholderText("Hertzy"), {
      target: { value: "Rover" },
    });
    fireEvent.change(screen.getByPlaceholderText("Hertzy-123"), {
      target: { value: "Rover-123" },
    });
    await vi.advanceTimersByTimeAsync(500);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /continue/i })).not.toBeDisabled(),
    );

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(screen.getByText("That handle is taken")).toBeInTheDocument());
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("redirects home immediately if the user is already onboarded", async () => {
    session = { user: { id: "u1", onboarded: true }, isAuthenticated: true, isLoading: false };
    renderPage();

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
  });

  it("signs out and redirects home instead of being stuck here", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /sign out instead/i }));

    await waitFor(() => expect(mocks.signOut).toHaveBeenCalled());
    expect(mocks.runSessionCleanups).toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith("/");
  });

  it("stops trusting a stale available result the moment the handle changes", async () => {
    renderPage();

    fireEvent.change(screen.getByPlaceholderText("Hertzy"), {
      target: { value: "Rover" },
    });
    fireEvent.change(screen.getByPlaceholderText("Hertzy-123"), {
      target: { value: "Rover-123" },
    });
    await vi.advanceTimersByTimeAsync(500);
    await waitFor(() => expect(screen.getByText(/is available/i)).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("Hertzy-123"), {
      target: { value: "Rover-456" },
    });

    expect(screen.queryByText(/is available/i)).not.toBeInTheDocument();
  });
});
