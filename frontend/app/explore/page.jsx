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

function ExploreContent() {
  const searchParams = useSearchParams();
  const search = searchParams.get("q") || "";
  const [notice, setNotice] = useState("");
  const noticeTimerRef = useRef(null);
  const games = useQuery(queries.games(search));
  const canUseLocalSearch = api.usingMocks;
  const gameData =
    games.data || (canUseLocalSearch ? fallbacks.games(search) : { items: [], meta: {} });
  const posts = games.isError && !canUseLocalSearch ? [] : fallbacks.posts({ search });
  const offlineSearch = Boolean(search && games.isError && !canUseLocalSearch);

  const showUnavailable = () => {
    window.clearTimeout(noticeTimerRef.current);
    setNotice("Smart Explore is not available yet");
    noticeTimerRef.current = window.setTimeout(() => setNotice(""), 1800);
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
        <button className="soft-btn" onClick={showUnavailable} type="button">
          <FiCompass /> Smart Explore
        </button>
      </section>

      <div className="explore-layout">
        <section>
          <SectionTitle action="Refresh">Recommended Communities</SectionTitle>
          <QueryNotice
            isLoading={games.isLoading}
            isError={games.isError}
            isEmpty={!gameData.items.length}
            errorText={
              offlineSearch
                ? "Search needs the backend. Start the API or enable mock mode to preview results."
                : undefined
            }
            emptyText="No communities found for this search."
          />
          <CommunityGrid communities={gameData.items} compact />

          <SectionTitle action="See More">Fresh Posts</SectionTitle>
          <div className="panel">
            <QueryNotice isEmpty={!posts.length} emptyText="No posts match this search yet." />
            <PostList posts={posts} />
          </div>
        </section>
        <aside className="panel filter-panel">
          <div className="panel-head">
            <h3>Explore Filters</h3>
            <FiSettings />
          </div>
          <div className="chips tall">
            <span>Guides</span>
            <span>Builds</span>
            <span>Lore</span>
            <span>Fan Art</span>
            <span>Events</span>
            <span>Teams</span>
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
