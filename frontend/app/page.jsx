"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FiChevronRight, FiCompass, FiSettings, FiX } from "react-icons/fi";
import { CommunityGrid } from "../components/CommunityGrid";
import { PostList } from "../components/PostList";
import { QueryNotice } from "../components/QueryNotice";
import { SectionTitle } from "../components/SectionTitle";
import { glyph } from "../components/constants";
import { fallbacks, queries } from "../lib/queries";
import { defaultFeedPreferences, FEED_PREFERENCES_KEY, readStoredJson } from "../lib/preferences";

const feedCategories = ["Guide", "Build", "Lore", "Teams", "Strategy"];

export default function HomePage() {
  const [tab, setTab] = useState("Hot");
  const [notice, setNotice] = useState("");
  const [customizing, setCustomizing] = useState(false);
  const [preferences, setPreferences] = useState(defaultFeedPreferences);
  const [draftPreferences, setDraftPreferences] = useState(defaultFeedPreferences);
  const noticeTimerRef = useRef(null);
  const customizerButtonRef = useRef(null);
  const customizerRef = useRef(null);
  const wasCustomizingRef = useRef(false);
  const home = useQuery(queries.home(""));
  const data = home.data || fallbacks.home("");
  const allForYouPosts = data.forYouPosts || data.posts || [];
  const selectedGames = new Set(preferences.games);
  const selectedCategories = new Set(preferences.categories);
  const visibleCommunities = selectedGames.size
    ? data.communities.filter((community) => selectedGames.has(community.slug))
    : data.communities;
  const forYouPosts = allForYouPosts.filter((post) => {
    const matchesGame = !selectedGames.size || selectedGames.has(post.gameSlug);
    const matchesCategory = !selectedCategories.size || selectedCategories.has(post.tag);
    return matchesGame && matchesCategory;
  });
  const trendingPosts =
    tab === "New"
      ? [...data.posts].reverse()
      : tab === "Top"
        ? [...data.posts].sort((a, b) => a.title.localeCompare(b.title))
        : data.posts;

  const showNotice = (message) => {
    window.clearTimeout(noticeTimerRef.current);
    setNotice(message);
    noticeTimerRef.current = window.setTimeout(() => setNotice(""), 1800);
  };

  const openCustomizer = () => {
    setDraftPreferences(preferences);
    setCustomizing(true);
  };

  const togglePreference = (group, value) => {
    setDraftPreferences((current) => ({
      ...current,
      [group]: current[group].includes(value)
        ? current[group].filter((item) => item !== value)
        : [...current[group], value],
    }));
  };

  const savePreferences = () => {
    window.localStorage.setItem(FEED_PREFERENCES_KEY, JSON.stringify(draftPreferences));
    setPreferences(draftPreferences);
    setCustomizing(false);
    showNotice("Feed preferences saved");
  };

  useEffect(() => () => window.clearTimeout(noticeTimerRef.current), []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setPreferences(readStoredJson(FEED_PREFERENCES_KEY, defaultFeedPreferences));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!customizing) return undefined;
    wasCustomizingRef.current = true;
    customizerRef.current?.querySelector("button")?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setCustomizing(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(
        customizerRef.current?.querySelectorAll(
          "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ) || [],
      ).filter((element) => element.offsetParent !== null);
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [customizing]);

  useEffect(() => {
    if (!customizing && wasCustomizingRef.current) {
      customizerButtonRef.current?.focus();
      wasCustomizingRef.current = false;
    }
  }, [customizing]);

  return (
    <div className="page home-page">
      <div className="toast-slot" aria-live="polite">
        {notice}
      </div>
      <section className="welcome hero-polish">
        <div>
          <span className="eyebrow">Today on GachaHub</span>
          <h1>
            Welcome back, Rover <span>{glyph.sparkle}</span>
          </h1>
          <p>Explore communities, discover builds, and uncover the lore.</p>
        </div>
        <button
          className="soft-btn"
          onClick={openCustomizer}
          ref={customizerButtonRef}
          type="button"
        >
          <FiSettings /> Customize Feed
        </button>
      </section>

      <SectionTitle action="View All" actionHref="/explore">
        Game Communities
      </SectionTitle>
      <QueryNotice
        isLoading={home.isLoading}
        isError={home.isError}
        isEmpty={!visibleCommunities.length}
        emptyText="No communities match your feed yet."
      />
      <CommunityGrid communities={visibleCommunities} />

      <section className="panel for-you-panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">For You</span>
            <h3>Across your games</h3>
          </div>
          <button className="text-btn" onClick={openCustomizer} type="button">
            Tune Feed <FiChevronRight />
          </button>
        </div>
        <p className="feed-copy">
          A personalized local feed based on your selected games and topics.
        </p>
        <QueryNotice
          isEmpty={!forYouPosts.length}
          emptyText="No For You posts are available yet."
        />
        <PostList posts={forYouPosts} />
      </section>

      <div className="dashboard-grid">
        <section className="panel trending">
          <div className="panel-head">
            <h3>Trending Posts</h3>
            <div aria-label="Trending post order" className="tabs small" role="tablist">
              {["Hot", "New", "Top"].map((item) => (
                <button
                  type="button"
                  onClick={() => setTab(item)}
                  className={tab === item ? "active" : ""}
                  key={item}
                  aria-selected={tab === item}
                  role="tab"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <PostList posts={trendingPosts} />
          <Link className="text-btn" href="/explore">
            View All Trending <FiChevronRight />
          </Link>
        </section>

        <div className="stack">
          <section className="panel ai-panel">
            <div className="panel-head">
              <h3>AI Summary</h3>
              <span className="beta">BETA</span>
            </div>
            <p>Here&apos;s what&apos;s happening across your communities.</p>
            <ul>
              <li>
                Version 2.2 introduces a new region, <b>&quot;Tethys System&quot;</b>.
              </li>
              <li>Sanhua and Cantarella headline the new banner phase.</li>
              <li>Players discovered hidden Rover interactions.</li>
            </ul>
            <Link className="panel-button" href="/summaries">
              Open summaries
            </Link>
          </section>
          <section className="panel lore">
            <div className="panel-head">
              <h3>Popular Lore Tags</h3>
              <FiCompass />
            </div>
            <div className="chips">
              <span>#TethysSystem</span>
              <span>#Lament</span>
              <span>#Rover</span>
              <span>#Sentinels</span>
            </div>
          </section>
        </div>
      </div>
      {customizing && (
        <div className="modal-backdrop" onClick={() => setCustomizing(false)}>
          <section
            aria-label="Customize feed"
            aria-modal="true"
            className="modal feed-customizer"
            onClick={(event) => event.stopPropagation()}
            ref={customizerRef}
            role="dialog"
          >
            <div className="panel-head">
              <div>
                <span className="eyebrow">Preferences</span>
                <h2>Customize your feed</h2>
              </div>
              <button
                aria-label="Close feed customizer"
                onClick={() => setCustomizing(false)}
                type="button"
              >
                <FiX />
              </button>
            </div>
            <fieldset>
              <legend>Games</legend>
              <div className="preference-grid">
                {data.communities.map((community) => (
                  <label key={community.slug}>
                    <input
                      checked={draftPreferences.games.includes(community.slug)}
                      onChange={() => togglePreference("games", community.slug)}
                      type="checkbox"
                    />
                    <span>{community.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Topics</legend>
              <div className="preference-grid compact">
                {feedCategories.map((category) => (
                  <label key={category}>
                    <input
                      checked={draftPreferences.categories.includes(category)}
                      onChange={() => togglePreference("categories", category)}
                      type="checkbox"
                    />
                    <span>{category}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="preference-hint">Leave a section empty to include everything.</p>
            <button className="primary" onClick={savePreferences} type="button">
              Save preferences
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
