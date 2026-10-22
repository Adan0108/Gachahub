export const FEED_PREFERENCES_KEY = "gachahub-feed-preferences";

export const defaultFeedPreferences: FeedPreferences = {
  games: [],
  categories: [],
} satisfies FeedPreferences;

export type FeedPreferences = {
  games: string[];
  categories: string[];
};

export function readStoredJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) || "null");
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}
