"use client";

import { useEffect, useSyncExternalStore } from "react";

const THEME_STORAGE_KEY = "gachahub-theme";
const THEME_CHANGE_EVENT = "gachahub-theme-change";

function isTheme(value) {
  return value === "dark" || value === "light";
}

function getStoredTheme() {
  try {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(savedTheme) ? savedTheme : "";
  } catch {
    return "";
  }
}

function getCookieTheme() {
  try {
    const themeCookie = document.cookie
      .split("; ")
      .find((cookie) => cookie.startsWith(`${THEME_STORAGE_KEY}=`));
    const cookieValue = themeCookie?.split("=")[1];
    const theme = cookieValue ? decodeURIComponent(cookieValue) : "";
    return isTheme(theme) ? theme : "";
  } catch {
    return "";
  }
}

function getPreferredTheme() {
  const savedTheme = getStoredTheme();
  if (savedTheme) return savedTheme;

  const savedCookieTheme = getCookieTheme();
  if (savedCookieTheme) return savedCookieTheme;

  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function subscribeTheme(callback) {
  window.addEventListener("storage", callback);
  window.addEventListener(THEME_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(THEME_CHANGE_EVENT, callback);
  };
}

function saveTheme(theme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Browser privacy settings may block storage; the in-memory theme still updates.
  }

  try {
    document.cookie = `${THEME_STORAGE_KEY}=${theme}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {
    // Cookie persistence is best-effort when browser policy blocks access.
  }
}

export function useTheme(initialTheme = "dark") {
  const theme = useSyncExternalStore(subscribeTheme, getPreferredTheme, () => initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggleTheme = () => {
    saveTheme(theme === "dark" ? "light" : "dark");
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  };

  return { theme, toggleTheme };
}
