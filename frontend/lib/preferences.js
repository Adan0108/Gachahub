export const FEED_PREFERENCES_KEY = "gachahub-feed-preferences";

export const defaultFeedPreferences = {
  games: [],
  categories: [],
};

export function readStoredJson(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || "null");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}
