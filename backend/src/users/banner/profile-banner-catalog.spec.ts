import {
  isBannerAvailable,
  PROFILE_BANNER_IDS,
  PROFILE_BANNERS,
} from './profile-banner-catalog';

describe('profile banner catalog', () => {
  it('has unique ids', () => {
    expect(new Set(PROFILE_BANNER_IDS).size).toBe(PROFILE_BANNERS.length);
  });

  it('has at least one free design so everyone can pick something', () => {
    expect(PROFILE_BANNERS.some((b) => b.tier === 'FREE')).toBe(true);
  });

  it('makes FREE designs available and PREMIUM ones locked', () => {
    expect(isBannerAvailable({ id: 'a', label: 'A', tier: 'FREE' })).toBe(true);
    expect(isBannerAvailable({ id: 'b', label: 'B', tier: 'PREMIUM' })).toBe(
      false,
    );
  });
});
