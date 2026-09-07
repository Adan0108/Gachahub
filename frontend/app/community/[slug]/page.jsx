"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Art } from "../../../components/Art";
import { BuildCard } from "../../../components/BuildCard";
import { PostList } from "../../../components/PostList";
import { QueryNotice } from "../../../components/QueryNotice";
import { SectionTitle } from "../../../components/SectionTitle";
import { artTones, builds, glyph } from "../../../components/constants";
import { fallbacks, queries } from "../../../lib/queries";
import { JOINED_COMMUNITIES_KEY, readStoredJson } from "../../../lib/preferences";

const teamComps = [
  {
    name: "Burst Rotation",
    description: "Fast opener with coordinated burst windows and reliable cleanup.",
    members: builds.slice(0, 3),
  },
  {
    name: "Sustained Pressure",
    description: "Flexible rotation focused on consistent damage and safe swaps.",
    members: [builds[1], builds[3], builds[0]],
  },
  {
    name: "Boss Breaker",
    description: "High-impact lineup for stagger windows and single-target encounters.",
    members: [builds[2], builds[0], builds[3]],
  },
];

function CommunityContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const selectedTab = searchParams.get("tab") || "Overview";
  const [joined, setJoined] = useState(false);

  const communityQuery = useQuery(queries.community(slug));
  const categoriesQuery = useQuery(queries.categories(slug));
  const fallbackCommunity = fallbacks.community(slug);
  const community = communityQuery.data || fallbackCommunity;
  const categories = useMemo(() => {
    const items = categoriesQuery.data || fallbacks.categories();
    return [
      "Overview",
      ...items.filter((category) => category.isActive !== false).map((category) => category.name),
      "Builds",
      "Teams",
    ].filter((item, index, all) => all.indexOf(item) === index);
  }, [categoriesQuery.data]);
  const activeTab = categories.includes(selectedTab) ? selectedTab : "Overview";
  const selectedCategory = (categoriesQuery.data || fallbacks.categories()).find(
    (category) => category.name === activeTab,
  );
  const categorySlug = ["Overview", "Builds", "Teams"].includes(activeTab)
    ? undefined
    : selectedCategory?.slug;
  const shouldLoadFeed = activeTab === "Overview" || Boolean(categorySlug);
  const feedQuery = useQuery({
    ...queries.gameFeed(slug, categorySlug),
    enabled: Boolean(slug) && shouldLoadFeed,
  });
  const fallbackCommunityPosts = fallbacks.posts({ gameSlug: slug });
  const fallbackFeedPosts = categorySlug
    ? fallbackCommunityPosts.filter((post) => {
        const tag = post.tag.toLowerCase();
        return tag === categorySlug || `${tag}s` === categorySlug;
      })
    : fallbackCommunityPosts;
  const communityPosts = feedQuery.data?.items || fallbackFeedPosts;
  const categoryPosts = communityPosts;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const joinedCommunities = readStoredJson(JOINED_COMMUNITIES_KEY, []);
      setJoined(joinedCommunities.includes(slug));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [slug]);

  const toggleJoined = () => {
    const joinedCommunities = readStoredJson(JOINED_COMMUNITIES_KEY, []);
    const nextJoined = !joined;
    const nextCommunities = nextJoined
      ? [...new Set([...joinedCommunities, slug])]
      : joinedCommunities.filter((item) => item !== slug);
    window.localStorage.setItem(JOINED_COMMUNITIES_KEY, JSON.stringify(nextCommunities));
    setJoined(nextJoined);
  };

  if (!community) {
    return (
      <div className="page">
        <section className="panel state-panel">
          <h1>Community not found</h1>
          <p>Try browsing Explore to find an available game community.</p>
          <Link className="inline-link" href="/explore">
            Go to Explore
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="page community-page">
      <QueryNotice
        isLoading={communityQuery.isLoading || categoriesQuery.isLoading}
        isError={communityQuery.isError || categoriesQuery.isError}
      />
      <section className="community-hero">
        <Art tone="indigo">
          <span className="hero-rune">{community.symbol}</span>
        </Art>
        <div className="hero-wordmark">{community.name.toUpperCase()}</div>
      </section>
      <section className="community-info">
        <div className="community-avatar">
          <Art tone="blue">{community.symbol}</Art>
        </div>
        <div className="community-copy">
          <h1>
            {community.name} <span className="verified">{glyph.check}</span>
          </h1>
          <p>
            {community.members} Members - {community.posts} Posts
          </p>
          <small>
            {community.description ||
              `A community for ${community.name} players to share builds, theories, lore, and guides.`}
          </small>
        </div>
        <button
          className={`join-btn ${joined ? "joined" : ""}`}
          aria-pressed={joined}
          onClick={toggleJoined}
          type="button"
        >
          {joined ? `${glyph.check} Joined` : "+ Join"}
        </button>
        <div className="top-characters">
          <small>Top Characters</small>
          <div>
            {artTones.map((tone, index) => (
              <span className={`character-dot art-${tone}`} key={tone}>
                {index + 1}
              </span>
            ))}
          </div>
        </div>
      </section>
      <div className="tabs wide" aria-label="Community content" role="tablist">
        {categories.map((item) => (
          <Link
            aria-selected={activeTab === item}
            className={activeTab === item ? "active" : ""}
            href={`/community/${encodeURIComponent(community.slug)}?tab=${encodeURIComponent(item)}`}
            key={item}
            role="tab"
          >
            {item}
          </Link>
        ))}
      </div>
      <div className="community-body">
        <section>
          {activeTab === "Overview" && (
            <div className="community-tab-content">
              <div>
                <SectionTitle>Latest discussions</SectionTitle>
                <QueryNotice
                  isLoading={feedQuery.isLoading}
                  isError={feedQuery.isError}
                  isEmpty={!communityPosts.length}
                  emptyText="No community discussions yet."
                />
                <PostList posts={communityPosts.slice(0, 3)} />
              </div>
              <div>
                <SectionTitle>Popular builds</SectionTitle>
                <div className="build-grid overview-builds">
                  {builds.slice(0, 2).map((build, index) => (
                    <BuildCard build={build} index={index} key={build.name} />
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === "Builds" && (
            <>
              <SectionTitle>Community builds</SectionTitle>
              <div className="build-grid">
                {builds.map((build, index) => (
                  <BuildCard build={build} index={index} key={build.name} />
                ))}
              </div>
            </>
          )}

          {activeTab === "Teams" && (
            <>
              <SectionTitle>Recommended teams</SectionTitle>
              <div className="team-grid">
                {teamComps.map((team) => (
                  <article className="panel team-card" key={team.name}>
                    <div>
                      <b>{team.name}</b>
                      <p>{team.description}</p>
                    </div>
                    <div className="team-members" aria-label={`${team.name} members`}>
                      {team.members.map((member) => (
                        <span className={`art-${member.tone}`} key={member.name}>
                          <i>{member.icon}</i>
                          <small>{member.name}</small>
                        </span>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}

          {!["Overview", "Builds", "Teams"].includes(activeTab) && (
            <>
              <SectionTitle>{activeTab} discussions</SectionTitle>
              <QueryNotice isLoading={feedQuery.isLoading} isError={feedQuery.isError} />
              {categoryPosts.length ? (
                <PostList posts={categoryPosts} />
              ) : (
                <div className="panel state-panel compact-state">
                  <h3>No {activeTab.toLowerCase()} posts yet</h3>
                  <p>Be the first community member to start this discussion.</p>
                </div>
              )}
            </>
          )}
        </section>
        <aside className="panel highlights">
          <div className="panel-head">
            <h3>Community Highlights</h3>
            <span className="panel-pill">Updated</span>
          </div>
          {["2.2 Livestream Recap", "Tethys System Map", "Lore Theory Megathread"].map(
            (item, index) => (
              <div className="highlight" key={item}>
                <span>{glyph.sparkle}</span>
                <div>
                  <b>{item}</b>
                  <small>
                    {
                      [
                        "New Echoes, events, and QOL changes coming!",
                        "Interactive map & chest locations.",
                        "Discuss the mysteries of the Lament!",
                      ][index]
                    }
                  </small>
                </div>
              </div>
            ),
          )}
        </aside>
      </div>
    </div>
  );
}

export default function CommunityPage() {
  return (
    <Suspense
      fallback={
        <div className="page">
          <div className="state-card">Loading community...</div>
        </div>
      }
    >
      <CommunityContent />
    </Suspense>
  );
}
