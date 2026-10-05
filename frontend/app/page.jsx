"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FiChevronRight, FiCompass, FiEdit3 } from "react-icons/fi";
import { CommunityGrid } from "../components/CommunityGrid";
import { PostList } from "../components/PostList";
import { QueryNotice } from "../components/QueryNotice";
import { SectionTitle } from "../components/SectionTitle";
import { glyph } from "../components/constants";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { api } from "../lib/api";
import { fallbacks, queries } from "../lib/queries";
import { defaultFeedPreferences, FEED_PREFERENCES_KEY, readStoredJson } from "../lib/preferences";

export default function HomePage() {
  const [preferences, setPreferences] = useState(defaultFeedPreferences);
  const { user } = useCurrentUser();
  const home = useQuery(queries.home(""));
  const data =
    home.data ||
    (api.usingMocks
      ? fallbacks.home("")
      : { communities: [], forYouPosts: [], posts: [], meta: {} });
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

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setPreferences(readStoredJson(FEED_PREFERENCES_KEY, defaultFeedPreferences));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const displayName = user?.name?.trim()?.split(/\s+/)[0];
  const avatarInitial = (displayName || user?.email || "G").charAt(0).toUpperCase();

  return (
    <div className="page home-page">
      <section className="welcome hero-polish">
        <div>
          <h1>
            {displayName ? `Welcome back, ${displayName}` : "Welcome back"}{" "}
            <span>{glyph.sparkle}</span>
          </h1>
          <p>Explore communities, discover builds, and uncover the lore.</p>
        </div>
      </section>

      <div className="home-feed-layout">
        <main className="home-feed-column">
          <section className="panel home-create-card">
            <div className="home-create-avatar">{avatarInitial}</div>
            <Link href="/create">Share a build, theory, or discovery...</Link>
            <Link aria-label="Create a post" className="home-create-action" href="/create">
              <FiEdit3 />
            </Link>
          </section>

          <section className="home-feed-section">
            <div className="home-feed-heading">
              <div>
                <span className="eyebrow">Your feed</span>
                <h2>Latest from your communities</h2>
              </div>
              <Link className="text-btn" href="/settings#feed-preferences">
                Tune Feed <FiChevronRight />
              </Link>
            </div>
            <QueryNotice
              isLoading={home.isLoading}
              isError={home.isError}
              isEmpty={!forYouPosts.length}
              emptyText="No posts match your feed yet."
              onRetry={() => home.refetch()}
            />
            <PostList posts={forYouPosts} variant="feed" />
          </section>
        </main>

        <aside className="home-feed-rail">
          <section className="panel home-community-panel">
            <SectionTitle action="View All" actionHref="/community">
              Your communities
            </SectionTitle>
            <QueryNotice
              isEmpty={!visibleCommunities.length}
              emptyText="No communities match your feed yet."
            />
            <CommunityGrid communities={visibleCommunities.slice(0, 3)} />
          </section>

          <section className="panel ai-panel">
            <div className="panel-head">
              <h3>AI Summary</h3>
              <span className="beta">BETA</span>
            </div>
            <p>Here&apos;s what&apos;s happening across your communities.</p>
            <ul>
              <li>Version 2.2 introduces the Tethys System.</li>
              <li>Sanhua and Cantarella headline the new banner phase.</li>
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
        </aside>
      </div>
    </div>
  );
}
