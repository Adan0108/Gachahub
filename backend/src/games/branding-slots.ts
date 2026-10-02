// Single source of truth for icon/banner - the DTO field, purpose, URL column, and label each slot needs, shared by GamesRepository and GameModerationService.
export const BRANDING_SLOTS = {
  icon: {
    idField: 'iconMediaUploadId',
    urlField: 'iconUrl',
    purpose: 'GAME_ICON',
    label: 'game icon',
  },
  banner: {
    idField: 'bannerMediaUploadId',
    urlField: 'bannerUrl',
    purpose: 'GAME_BANNER',
    label: 'game banner',
  },
} as const;

export type BrandingSlotKey = keyof typeof BRANDING_SLOTS;

// One side of a branding replace - an already-validated, confirmed upload.
export type BrandingUpload = { id: string; secureUrl: string };
