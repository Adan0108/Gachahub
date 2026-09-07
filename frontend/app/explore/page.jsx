"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { FiCompass, FiSettings } from "react-icons/fi";
import { CommunityGrid } from "../../components/CommunityGrid";
import { PostList } from "../../components/PostList";
import { QueryNotice } from "../../components/QueryNotice";
import { SectionTitle } from "../../components/SectionTitle";
import { api } from "../../lib/api";
import { fallbacks, queries } from "../../lib/queries";
import {
  defaultFeedPreferences,
  FEED_PREFERENCES_KEY,
  readStoredJson,
} from "../../lib/preferences";

function ExploreContent() {
  const searchParams = useSearchParams();
  const search = searchParams.get("q") || "";
  const [activeFilter, setActiveFilter] = useState("All");
  const [notice, setNotice] = useState("");
  const [smartGames, setSmartGames] = useState([]);
  const [smartMode, setSmartMode] = useState(false);
  const noticeTimerRef = useRef(null);
  const games = useQuery(queries.games(search));
  const postsQuery = useQuery(queries.posts(search));
  const canUseLocalSearch = api.usingMocks;
  const gameData =
    games.data ||
    (canUseLocalSearch || smartMode ? fallbacks.games(search) : { items: [], meta: {} });
  const posts = postsQuery.data?.items || fallbacks.posts({ search });
  const filteredPosts = posts.filter((post) => {
    if (smartGames.length && !smartGames.includes(post.gameSlug)) return false;
    if (activeFilter === "All") return true;

    const filterTags = {
      Guides: ["Guide", "Strategy"],
      Builds: ["Build"],
      Lore: ["Lore", "Theory"],
      "Fan Art": ["Fan Art"],
      Events: ["Event", "News"],
      Teams: ["Teams"],
    };

    return filterTags[activeFilter]?.includes(post.tag);
  });
  const recommendedCommunities = smartGames.length
    ? [...gameData.items].sort(
        (a, b) => Number(smartGames.includes(b.slug)) - Number(smartGames.includes(a.slug)),
      )
    : gameData.items;
  const offlineSearch = Boolean(search && games.isError && !canUseLocalSearch);

  const applySmartExplore = () => {
    const preferences = readStoredJson(FEED_PREFERENCES_KEY, defaultFeedPreferences);
    setSmartMode(true);
    setSmartGames(preferences.games);
    const preferredCategory = preferences.categories[0];
    const filterByCategory = {
      Guide: "Guides",
      Strategy: "Guides",
      Build: "Builds",
      Lore: "Lore",
      Teams: "Teams",
    };
    setActiveFilter(filterByCategory[preferredCategory] || "All");
    window.clearTimeout(noticeTimerRef.current);
    setNotice(
      preferences.games.length || preferences.categories.length
        ? "Smart recommendations applied from your feed preferences"
        : "Choose feed preferences on Home for tailored recommendations",
    );
    noticeTimerRef.current = window.setTimeout(() => setNotice(""), 1800);
  };

  const updateFilter = (filter) => {
    setActiveFilter(filter);
  };

  useEffect(() => () => window.clearTimeout(noticeTimerRef.current), []);

  return (
    <div className="page explore-page">
      <div className="toast-slot" aria-live="polite">
        {notice}
      </div>
      <section className="welcome hero-polish explore-hero">
        <div>
          <span className="eyebrow">Discover</span>
          <h1>
            {search
              ? `Search results for "${search}"`
              : "Explore new builds, theories, and creators."}
          </h1>
          <p>
            Find new communities, trending posts, character guides, and recommendations in one
            place.
          </p>
        </div>
        <button className="soft-btn" onClick={applySmartExplore} type="button">
          <FiCompass /> Smart Explore
        </button>
      </section>

      <div className="explore-layout">
        <section>
          <div className="section-title">
            <h2>Recommended Communities</h2>
            <button className="text-btn" onClick={() => games.refetch()} type="button">
              Refresh
            </button>
          </div>
          <QueryNotice
            isLoading={games.isLoading}
            isError={games.isError}
            isEmpty={!recommendedCommunities.length}
            errorText={
              offlineSearch
                ? "Search needs the backend. Start the API or enable mock mode to preview results."
                : undefined
            }
            emptyText="No communities found for this search."
          />
          <CommunityGrid communities={recommendedCommunities} compact />

          <SectionTitle>Fresh Posts</SectionTitle>
          <div className="panel">
            <QueryNotice
              isLoading={postsQuery.isLoading}
              isError={postsQuery.isError}
              isEmpty={!filteredPosts.length}
              emptyText={`No ${activeFilter === "All" ? "posts" : activeFilter.toLowerCase()} match this search yet.`}
            />
            <PostList posts={filteredPosts} />
          </div>
        </section>
        <aside className="panel filter-panel">
          <div className="panel-head">
            <h3>Explore Filters</h3>
            <FiSettings />
          </div>
          <div className="chips tall">
            {["All", "Guides", "Builds", "Lore", "Fan Art", "Events", "Teams"].map((filter) => (
              <button
                aria-pressed={activeFilter === filter}
                className={activeFilter === filter ? "active" : ""}
                key={filter}
                onClick={() => updateFilter(filter)}
                type="button"
              >
                {filter}
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function ExplorePage() {
  return (
    <Suspense
      fallback={
        <div className="page">
          <div className="state-card">Loading explore...</div>
        </div>
      }
    >
      <ExploreContent />
    </Suspense>
  );
}
