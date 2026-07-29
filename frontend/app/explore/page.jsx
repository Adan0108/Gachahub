"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { FiCompass, FiSettings } from "react-icons/fi";
import { CommunityGrid } from "../../components/CommunityGrid";
import { PostList } from "../../components/PostList";
import { QueryNotice } from "../../components/QueryNotice";
import { SectionTitle } from "../../components/SectionTitle";
import { fallbacks, queries } from "../../lib/queries";

function ExploreContent() {
  const searchParams = useSearchParams();
  const search = searchParams.get("q") || "";
  const games = useQuery(queries.games(search));
  const gameData = games.data || fallbacks.games(search);
  const posts = fallbacks.posts({ search });

  return (
    <div className="page explore-page">
      <section className="welcome hero-polish explore-hero">
        <div>
          <span className="eyebrow">Discover</span>
          <h1>{search ? `Search results for "${search}"` : "Explore new builds, theories, and creators."}</h1>
          <p>Find new communities, trending posts, character guides, and recommendations in one place.</p>
        </div>
        <button className="soft-btn" type="button"><FiCompass /> Smart Explore</button>
      </section>

      <div className="explore-layout">
        <section>
          <SectionTitle action="Refresh">Recommended Communities</SectionTitle>
          <QueryNotice isLoading={games.isLoading} isError={games.isError} isEmpty={!gameData.items.length} emptyText="No communities found for this search." />
          <CommunityGrid communities={gameData.items} compact />

          <SectionTitle action="See More">Fresh Posts</SectionTitle>
          <div className="panel">
            <QueryNotice isEmpty={!posts.length} emptyText="No posts match this search yet." />
            <PostList posts={posts} />
          </div>
        </section>
        <aside className="panel filter-panel">
          <div className="panel-head"><h3>Explore Filters</h3><FiSettings /></div>
          <div className="chips tall"><span>Guides</span><span>Builds</span><span>Lore</span><span>Fan Art</span><span>Events</span><span>Teams</span></div>
        </aside>
      </div>
    </div>
  );
}

export default function ExplorePage() {
  return (
    <Suspense fallback={<div className="page"><div className="state-card">Loading explore...</div></div>}>
      <ExploreContent />
    </Suspense>
  );
}
