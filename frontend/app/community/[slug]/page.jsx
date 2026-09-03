"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Art } from "../../../components/Art";
import { BuildCard } from "../../../components/BuildCard";
import { QueryNotice } from "../../../components/QueryNotice";
import { SectionTitle } from "../../../components/SectionTitle";
import { artTones, builds, glyph } from "../../../components/constants";
import { fallbacks, queries } from "../../../lib/queries";
import { JOINED_COMMUNITIES_KEY, readStoredJson } from "../../../lib/preferences";

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
      <div className="tabs wide">
        {categories.map((item) => (
          <Link
            className={selectedTab === item ? "active" : ""}
            href={`/community/${encodeURIComponent(community.slug)}?tab=${encodeURIComponent(item)}`}
            key={item}
          >
            {item}
          </Link>
        ))}
      </div>
      <div className="community-body">
        <section>
          <SectionTitle>Featured {selectedTab}</SectionTitle>
          <div className="build-grid">
            {builds.map((build, index) => (
              <BuildCard build={build} index={index} key={build.name} />
            ))}
          </div>
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
