// How each backend banner id (backend/src/users/banner/profile-banner-catalog.ts) looks: a solid colour.
const BANNER_COLORS = {
  violet: "#6d4aff",
  blue: "#2f6fed",
  amber: "#d98324",
  rose: "#d94a6a",
  teal: "#14a39a",
  slate: "#475069",
};

/** Solid colour for a stored banner id; null (nothing picked, or a since-retired id) means the default banner. */
export function bannerColor(bannerPresetId) {
  return BANNER_COLORS[bannerPresetId] ?? null;
}
