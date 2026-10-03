// How each backend banner design id (backend/src/users/banner/profile-banner-catalog.ts) looks: an `Art` tone.
const BANNER_TONES = {
  "violet-dusk": "violet",
  "azure-tide": "blue",
  "amber-glow": "amber",
  "rose-haze": "rose",
  "cyan-grid": "cyan",
  "indigo-night": "indigo",
};

const DEFAULT_BANNER_TONE = "indigo";

/** Art tone for a stored banner id; an unset or since-retired id shows the default. */
export function bannerTone(bannerPresetId) {
  return BANNER_TONES[bannerPresetId] ?? DEFAULT_BANNER_TONE;
}
