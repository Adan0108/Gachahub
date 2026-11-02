import type { CSSProperties } from "react";
import { bannerColor } from "./profileBanners";

export type CosmeticSlot =
  | "FRAME"
  | "PROFILE_BACKGROUND"
  | "MINI_BACKGROUND"
  | "BANNER";

export type CosmeticRarity =
  | "DUST"
  | "GLINT"
  | "GLIMMER"
  | "RADIANT"
  | "PRISMATIC";

export type CosmeticSource = "PULL" | "SPARK" | "ADMIN";

export interface EquippedCosmetic {
  id: string;
  slug: string;
  name: string;
  slot: CosmeticSlot;
  rarity: CosmeticRarity;
  animated: boolean;
  assetUrl: string | null;
  presetId: string | null;
}

export interface EquippedCosmeticsMap {
  frame: EquippedCosmetic | null;
  profileBackground: EquippedCosmetic | null;
  miniBackground: EquippedCosmetic | null;
  banner: EquippedCosmetic | null;
}

export interface UserHoverCardData {
  id: string;
  name?: string | null;
  username?: string | null;
  image?: string | null;
  bio?: string | null;
  bannerPresetId?: string | null;
  rank?: string;
  reputation?: number;
  /** null when the profile is private to this viewer. */
  followersCount?: number | null;
  followingCount?: number;
  isFollowing?: boolean;
  followsYou?: boolean;
  isBlockedByMe?: boolean;
  premium?: boolean;
  equipped?: EquippedCosmeticsMap | null;
}

export interface OwnedCosmeticEntry {
  itemId: string;
  source: CosmeticSource;
  acquiredAt: string;
  item: {
    id: string;
    slug: string;
    name: string;
    description: string;
    slot: CosmeticSlot;
    rarity: CosmeticRarity;
    animated: boolean;
    assetUrl: string | null;
    presetId: string | null;
  };
}

export interface MyCosmeticsResponse {
  owned: OwnedCosmeticEntry[];
  equipped: EquippedCosmeticsMap;
}

export interface AdminCosmeticItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  slot: CosmeticSlot;
  rarity: CosmeticRarity;
  animated: boolean;
  assetUrl: string | null;
  presetId: string | null;
  active: boolean;
  createdAt: string;
  ownerCount: number;
  equippedCount: number;
}

export const COSMETIC_SLOTS: {
  slot: CosmeticSlot;
  key: keyof EquippedCosmeticsMap;
  label: string;
  shortLabel: string;
}[] = [
  { slot: "FRAME", key: "frame", label: "Avatar Frame", shortLabel: "Frames" },
  {
    slot: "PROFILE_BACKGROUND",
    key: "profileBackground",
    label: "Profile Background",
    shortLabel: "Profile BG",
  },
  {
    slot: "MINI_BACKGROUND",
    key: "miniBackground",
    label: "Hover Card Background",
    shortLabel: "Hover BG",
  },
  {
    slot: "BANNER",
    key: "banner",
    label: "Profile Banner",
    shortLabel: "Banners",
  },
];

export const RARITY_META: Record<
  CosmeticRarity,
  {
    name: string;
    stars: string;
    starCount: number;
    color: string;
    refundShards: number;
  }
> = {
  DUST: {
    name: "Dust",
    stars: "★",
    starCount: 1,
    color: "#94a3b8",
    refundShards: 5,
  },
  GLINT: {
    name: "Glint",
    stars: "★★",
    starCount: 2,
    color: "#34d399",
    refundShards: 10,
  },
  GLIMMER: {
    name: "Glimmer",
    stars: "★★★",
    starCount: 3,
    color: "#60a5fa",
    refundShards: 30,
  },
  RADIANT: {
    name: "Radiant",
    stars: "★★★★",
    starCount: 4,
    color: "#c084fc",
    refundShards: 80,
  },
  PRISMATIC: {
    name: "Prismatic",
    stars: "★★★★★",
    starCount: 5,
    color: "#fbbf24",
    refundShards: 300,
  },
};

export const STARTER_PRESET_IDS: Record<CosmeticSlot, { id: string; label: string }[]> = {
  FRAME: [
    { id: "frame-starlight-ring", label: "Starlight Ring (3★)" },
    { id: "frame-verdant-bloom", label: "Verdant Bloom (3★)" },
    { id: "frame-ember-crest", label: "Ember Crest (3★)" },
    { id: "frame-astral-orbit", label: "Astral Orbit (4★ Animated)" },
    { id: "frame-nebula-halo", label: "Nebula Halo (4★ Animated)" },
    { id: "frame-prismatic-crown", label: "Prismatic Crown (5★ Animated)" },
  ],
  PROFILE_BACKGROUND: [
    { id: "pbg-twilight-observatory", label: "Twilight Observatory (3★)" },
    { id: "pbg-seafoam-sanctuary", label: "Seafoam Sanctuary (3★)" },
    { id: "pbg-crimson-archive", label: "Crimson Archive (3★)" },
    { id: "pbg-aurora-drift", label: "Aurora Drift (4★ Animated)" },
    { id: "pbg-void-constellation", label: "Void Constellation (4★ Animated)" },
    { id: "pbg-celestial-convergence", label: "Celestial Convergence (5★ Animated)" },
  ],
  MINI_BACKGROUND: [
    { id: "mbg-cobalt-dusk", label: "Cobalt Dusk (3★)" },
    { id: "mbg-rose-quartz", label: "Rose Quartz (3★)" },
    { id: "mbg-starfall-veil", label: "Starfall Veil (4★ Animated)" },
    { id: "mbg-sovereign-aether", label: "Sovereign Aether (5★ Animated)" },
  ],
  BANNER: [
    { id: "bnr-horizon-stride", label: "Horizon Stride (3★)" },
    { id: "bnr-gilded-dawn", label: "Gilded Dawn (3★)" },
    { id: "bnr-eclipse-corona", label: "Eclipse Corona (4★ Animated)" },
    { id: "bnr-supernova-anthem", label: "Supernova Anthem (5★ Animated)" },
  ],
};

export type ResolvedBanner =
  | { kind: "custom"; url: string }
  | { kind: "cosmetic"; item: EquippedCosmetic }
  | { kind: "preset"; presetId: string; color: string }
  | { kind: "default" };

/**
 * Section 6.3 Banner precedence:
 * 1. Custom banner picture (while premium)
 * 2. Equipped banner item
 * 3. Free preset banner (`bannerPresetId`)
 * 4. Default
 */
export function resolveBanner(params: {
  premium?: boolean;
  customBannerUrl?: string | null;
  equippedBanner?: EquippedCosmetic | null;
  bannerPresetId?: string | null;
}): ResolvedBanner {
  if (params.premium && params.customBannerUrl) {
    return { kind: "custom", url: params.customBannerUrl };
  }
  if (params.equippedBanner) {
    return { kind: "cosmetic", item: params.equippedBanner };
  }
  const color = bannerColor(params.bannerPresetId);
  if (params.bannerPresetId && color) {
    return { kind: "preset", presetId: params.bannerPresetId, color };
  }
  return { kind: "default" };
}

/** A quoted CSS url(), so a URL with spaces, quotes or brackets can't break the declaration. */
const cssUrl = (url: string) => `url(${JSON.stringify(url)})`;

/** Class and inline style that draw a background-type cosmetic: its CSS preset, or else its image. */
export function cosmeticSurface(item: EquippedCosmetic | null | undefined): {
  className: string;
  style?: CSSProperties;
} {
  if (!item) return { className: "" };
  if (item.presetId) return { className: `cosmetic-preset-${item.presetId}` };
  return {
    className: "",
    style: item.assetUrl ? { backgroundImage: cssUrl(item.assetUrl) } : undefined,
  };
}

/** The same for whichever banner resolveBanner picked. */
export function bannerSurface(banner: ResolvedBanner): { className: string; style?: CSSProperties } {
  if (banner.kind === "custom") return { className: "", style: { backgroundImage: cssUrl(banner.url) } };
  if (banner.kind === "cosmetic") return cosmeticSurface(banner.item);
  if (banner.kind === "preset") return { className: "", style: { backgroundColor: banner.color } };
  return { className: "" };
}
