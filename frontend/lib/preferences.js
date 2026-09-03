export const FEED_PREFERENCES_KEY = "gachahub-feed-preferences";
export const JOINED_COMMUNITIES_KEY = "gachahub-joined-communities";

export const defaultFeedPreferences = {
  games: [],
  categories: [],
};

export function readStoredJson(key, fallback) {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || "null");
    return value ?? fallback;
  } catch {
    window.localStorage.removeItem(key);
    return fallback;
  }
}
