export type BannerTier = 'FREE' | 'PREMIUM';

export type ProfileBanner = { id: string; label: string; tier: BannerTier };

// Designs users can pick for their profile banner. The ids are the contract with the frontend, which owns how each one looks.
export const PROFILE_BANNERS: readonly ProfileBanner[] = [
  { id: 'violet-dusk', label: 'Violet Dusk', tier: 'FREE' },
  { id: 'azure-tide', label: 'Azure Tide', tier: 'FREE' },
  { id: 'amber-glow', label: 'Amber Glow', tier: 'FREE' },
  { id: 'rose-haze', label: 'Rose Haze', tier: 'FREE' },
  { id: 'cyan-grid', label: 'Cyan Grid', tier: 'FREE' },
  { id: 'indigo-night', label: 'Indigo Night', tier: 'FREE' },
];

export const PROFILE_BANNER_IDS = PROFILE_BANNERS.map((banner) => banner.id);

// The one place that decides who may use a banner; PREMIUM stays locked until purchases/entitlements exist.
export function isBannerAvailable(banner: ProfileBanner): boolean {
  return banner.tier === 'FREE';
}
