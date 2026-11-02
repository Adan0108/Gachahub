import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AvatarFace } from "../components/AvatarFace";
import { EditProfileDialog } from "../components/profile/EditProfileDialog";
import {
  ProfileHoverCardView,
  ProfileHoverTrigger,
} from "../components/profile/ProfileHoverCard";
import {
  COSMETIC_SLOTS,
  RARITY_META,
  STARTER_PRESET_IDS,
  resolveBanner,
  type EquippedCosmetic,
} from "../lib/cosmetics";
import { ledgerReasonLabel } from "../lib/economy";

const mocks = vi.hoisted(() => ({
  viewer: { id: "viewer-1", name: "Viewer" } as { id: string; name: string } | null,
  getUserCard: vi.fn(),
  getMyCosmetics: vi.fn(),
  equipCosmetic: vi.fn(),
  followUser: vi.fn(),
  unfollowUser: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    user: mocks.viewer,
    isAuthenticated: Boolean(mocks.viewer),
    isLoading: false,
  }),
}));

vi.mock("../components/profile/AvatarEditor", () => ({ AvatarEditor: () => null }));
vi.mock("../components/profile/BannerPicker", () => ({ BannerPicker: () => null }));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getUserCard: mocks.getUserCard,
      getMyCosmetics: mocks.getMyCosmetics,
      equipCosmetic: mocks.equipCosmetic,
      followUser: mocks.followUser,
      unfollowUser: mocks.unfollowUser,
    },
  };
});

const sampleFrame: EquippedCosmetic = {
  id: "cos-frame-1",
  slug: "frame-prismatic-crown",
  name: "Prismatic Crown",
  slot: "FRAME",
  rarity: "PRISMATIC",
  animated: true,
  assetUrl: null,
  presetId: "frame-prismatic-crown",
};

const sampleBanner: EquippedCosmetic = {
  id: "cos-banner-1",
  slug: "bnr-supernova-anthem",
  name: "Supernova Anthem",
  slot: "BANNER",
  rarity: "PRISMATIC",
  animated: true,
  assetUrl: null,
  presetId: "bnr-supernova-anthem",
};

const sampleMiniBg: EquippedCosmetic = {
  id: "cos-mbg-1",
  slug: "mbg-sovereign-aether",
  name: "Sovereign Aether",
  slot: "MINI_BACKGROUND",
  rarity: "PRISMATIC",
  animated: true,
  assetUrl: null,
  presetId: "mbg-sovereign-aether",
};

function renderWithQuery(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("Phase 2 — Cosmetics catalog & Banner precedence (Section 6)", () => {
  it("defines 20 starter presets across 4 slots and exact takedown refund Shard amounts", () => {
    expect(COSMETIC_SLOTS).toHaveLength(4);
    expect(STARTER_PRESET_IDS.FRAME).toHaveLength(6);
    expect(STARTER_PRESET_IDS.PROFILE_BACKGROUND).toHaveLength(6);
    expect(STARTER_PRESET_IDS.MINI_BACKGROUND).toHaveLength(4);
    expect(STARTER_PRESET_IDS.BANNER).toHaveLength(4);

    expect(RARITY_META.GLIMMER.refundShards).toBe(30);
    expect(RARITY_META.RADIANT.refundShards).toBe(80);
    expect(RARITY_META.PRISMATIC.refundShards).toBe(300);
    expect(ledgerReasonLabel("TAKEDOWN_REFUND")).toBe("Cosmetic takedown refund");
  });

  it("enforces Section 6.3 banner precedence: custom (while premium) > equipped banner > preset > default", () => {
    // 1. Custom banner while premium wins over equipped cosmetic and preset
    expect(
      resolveBanner({
        premium: true,
        customBannerUrl: "https://cdn/custom.png",
        equippedBanner: sampleBanner,
        bannerPresetId: "violet",
      }),
    ).toEqual({ kind: "custom", url: "https://cdn/custom.png" });

    // 2. When premium lapses, custom banner is ignored and equipped cosmetic banner wins
    expect(
      resolveBanner({
        premium: false,
        customBannerUrl: "https://cdn/custom.png",
        equippedBanner: sampleBanner,
        bannerPresetId: "violet",
      }),
    ).toEqual({ kind: "cosmetic", item: sampleBanner });

    // 3. When no equipped cosmetic banner, free preset banner wins
    const presetResolved = resolveBanner({
      premium: false,
      equippedBanner: null,
      bannerPresetId: "violet",
    });
    expect(presetResolved.kind).toBe("preset");

    // 4. Default when nothing is set
    expect(resolveBanner({ premium: false, equippedBanner: null, bannerPresetId: null })).toEqual({
      kind: "default",
    });
  });

  it("renders AvatarFace with a cosmetic frame overlay when frame is provided", () => {
    const { container } = render(
      <AvatarFace fallback="R" frame={sampleFrame} image={null} name="Rover" />,
    );
    const overlay = container.querySelector(
      ".avatar-frame-overlay.cosmetic-preset-frame-prismatic-crown",
    );
    expect(overlay).toBeInTheDocument();
    expect(overlay).toHaveAttribute("data-frame-slug", "frame-prismatic-crown");
  });
});

describe("Phase 2 — ProfileHoverCardView & ProfileHoverTrigger (Section 8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.viewer = { id: "viewer-1", name: "Viewer" };
  });

  const baseCard = {
    id: "target-1",
    name: "Astra",
    username: "astra",
    image: null,
    bio: "Stargazer",
    rank: "SUPERNOVA",
    reputation: 1500,
    followersCount: 2400,
    followingCount: 18,
    isFollowing: false,
    followsYou: true,
    isBlockedByMe: false,
    premium: true,
    bannerPresetId: "violet",
    equipped: {
      frame: sampleFrame,
      profileBackground: null,
      miniBackground: sampleMiniBg,
      banner: sampleBanner,
    },
  };

  it("renders banner, mini background scrim, framed avatar, supporter badge, rank, reputation, followers, and Follow button", () => {
    const { container } = renderWithQuery(
      <ProfileHoverCardView card={baseCard} userId="target-1" viewerId="viewer-1" />,
    );

    expect(screen.getByText("Astra")).toBeInTheDocument();
    expect(screen.getByText("@astra")).toBeInTheDocument();
    expect(screen.getByText("★ Supporter")).toBeInTheDocument();
    expect(screen.getByText("Follows you")).toBeInTheDocument();
    expect(screen.getByText("Supernova")).toBeInTheDocument();
    expect(screen.getByText("1,500")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Follow back/i })).toBeInTheDocument();
    expect(container.querySelector(".profile-hover-mini-scrim")).toBeInTheDocument();
    expect(
      container.querySelector(".profile-hover-banner.cosmetic-preset-bnr-supernova-anthem"),
    ).toBeInTheDocument();
  });

  it("shows Edit Profile instead of Follow when viewing your own hover card", () => {
    renderWithQuery(
      <ProfileHoverCardView card={baseCard} userId="target-1" viewerId="target-1" />,
    );

    expect(screen.getByRole("link", { name: "Edit Profile" })).toHaveAttribute(
      "href",
      "/user/target-1",
    );
    expect(screen.queryByRole("button", { name: /Follow/i })).toBeNull();
  });

  it("shows 'You blocked this person' and hides Follow when isBlockedByMe is true", () => {
    renderWithQuery(
      <ProfileHoverCardView
        card={{ ...baseCard, isBlockedByMe: true }}
        userId="target-1"
        viewerId="viewer-1"
      />,
    );

    expect(screen.getByText("You blocked this person")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Follow/i })).toBeNull();
  });

  it("links Follow to /login when the viewer is signed out", () => {
    mocks.viewer = null;
    renderWithQuery(
      <ProfileHoverCardView card={baseCard} userId="target-1" viewerId={null} />,
    );

    expect(screen.getByRole("link", { name: "Follow" })).toHaveAttribute("href", "/login");
  });

  it("shows 'This account isn't available' on 404 / error", () => {
    renderWithQuery(
      <ProfileHoverCardView card={null} isError userId="missing-user" viewerId="viewer-1" />,
    );

    expect(screen.getByText("This account isn't available")).toBeInTheDocument();
  });

  it("opens after 400ms hover delay and closes on Escape", async () => {
    mocks.getUserCard.mockResolvedValue(baseCard);

    renderWithQuery(
      <ProfileHoverTrigger userId="target-1">
        <button type="button">Hover Astra</button>
      </ProfileHoverTrigger>,
    );

    const trigger = screen.getByText("Hover Astra").closest(".profile-hover-trigger")!;
    fireEvent.mouseEnter(trigger);

    // Not open immediately
    expect(screen.queryByRole("dialog", { name: "Mini profile card" })).toBeNull();

    // Opens after 400ms delay and resolves userCard query
    expect(await screen.findByRole("dialog", { name: "Mini profile card" })).toBeInTheDocument();
    expect(await screen.findByText("Astra")).toBeInTheDocument();
    expect(mocks.getUserCard).toHaveBeenCalledWith("target-1", expect.anything());

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Mini profile card" })).toBeNull(),
    );
  });

  it("lets keyboard users Tab from the name into the card and keeps it open", async () => {
    mocks.getUserCard.mockResolvedValue(baseCard);
    renderWithQuery(
      <ProfileHoverTrigger userId="target-1">
        <button type="button">Hover Astra</button>
      </ProfileHoverTrigger>,
    );

    const name = screen.getByText("Hover Astra");
    name.focus();
    const card = await screen.findByRole("dialog", { name: "Mini profile card" });
    await screen.findByText("Astra");

    fireEvent.keyDown(name, { key: "Tab" });

    expect(card.contains(document.activeElement)).toBe(true);
    fireEvent.blur(name, { relatedTarget: document.activeElement });
    expect(screen.getByRole("dialog", { name: "Mini profile card" })).toBeInTheDocument();
  });
});

describe("Phase 2 — EditProfileDialog Cosmetics tab (Section 6.5)", () => {
  it("lists owned cosmetics by slot, previews selection, and equips on Save changes", async () => {
    mocks.getMyCosmetics.mockResolvedValue({
      owned: [
        {
          itemId: sampleFrame.id,
          source: "ADMIN",
          acquiredAt: "2026-10-30T00:00:00.000Z",
          item: {
            ...sampleFrame,
            description: "Crown of prismatic light",
          },
        },
      ],
      equipped: {
        frame: null,
        profileBackground: null,
        miniBackground: null,
        banner: null,
      },
    });
    mocks.equipCosmetic.mockResolvedValue({
      equipped: {
        frame: sampleFrame,
        profileBackground: null,
        miniBackground: null,
        banner: null,
      },
    });

    const onClose = vi.fn();
    renderWithQuery(
      <EditProfileDialog
        onClose={onClose}
        user={{
          id: "viewer-1",
          name: "Viewer",
          username: "viewer",
          bio: "Hello",
          image: null,
          bannerPresetId: null,
          equipped: {
            frame: null,
            profileBackground: null,
            miniBackground: null,
            banner: null,
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Cosmetics" }));

    expect(await screen.findByText("Prismatic Crown")).toBeInTheDocument();
    expect(screen.getByText(/★★★★★ Prismatic/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Prismatic Crown"));

    const saveBtn = screen.getByRole("button", { name: "Save changes" });
    expect(saveBtn).toBeEnabled();
    fireEvent.click(saveBtn);

    await waitFor(() =>
      expect(mocks.equipCosmetic).toHaveBeenCalledWith("FRAME", "cos-frame-1"),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
