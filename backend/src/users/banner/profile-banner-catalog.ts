export type BannerTier = 'FREE' | 'PREMIUM';

export type ProfileBanner = { id: string; label: string; tier: BannerTier };

// Designs users can pick for their profile banner. The ids are the contract with the frontend, which owns how each one looks.
export const PROFILE_BANNERS: readonly ProfileBanner[] = [
  { id: 'violet', label: 'Violet', tier: 'FREE' },
  { id: 'blue', label: 'Blue', tier: 'FREE' },
  { id: 'amber', label: 'Amber', tier: 'FREE' },
  { id: 'rose', label: 'Rose', tier: 'FREE' },
  { id: 'teal', label: 'Teal', tier: 'FREE' },
  { id: 'slate', label: 'Slate', tier: 'FREE' },
];

export const PROFILE_BANNER_IDS = PROFILE_BANNERS.map((banner) => banner.id);

// The one place that decides who may use a banner; PREMIUM stays locked until purchases/entitlements exist.
export function isBannerAvailable(banner: ProfileBanner): boolean {
  return banner.tier === 'FREE';
}
