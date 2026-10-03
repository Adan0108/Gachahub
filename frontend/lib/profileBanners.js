// How each backend banner id (backend/src/users/banner/profile-banner-catalog.ts) looks: a solid colour.
const BANNER_COLORS = {
  violet: "#6a5eb0",
  blue: "#4a74b4",
  amber: "#b58452",
  rose: "#b5586f",
  teal: "#44908b",
  slate: "#566077",
};

/** Solid colour for a stored banner id; null (nothing picked, or a since-retired id) means the default banner. */
export function bannerColor(bannerPresetId) {
  return BANNER_COLORS[bannerPresetId] ?? null;
}
