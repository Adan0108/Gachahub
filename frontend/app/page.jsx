"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FiChevronRight, FiCompass, FiSettings } from "react-icons/fi";
import { CommunityGrid } from "../components/CommunityGrid";
import { PostList } from "../components/PostList";
import { QueryNotice } from "../components/QueryNotice";
import { SectionTitle } from "../components/SectionTitle";
import { glyph } from "../components/constants";
import { fallbacks, queries } from "../lib/queries";

export default function HomePage() {
  const [tab, setTab] = useState("Hot");
  const [notice, setNotice] = useState("");
  const noticeTimerRef = useRef(null);
  const home = useQuery(queries.home(""));
  const data = home.data || fallbacks.home("");
  const forYouPosts = data.forYouPosts || data.posts || [];

  const showNotice = (message) => {
    window.clearTimeout(noticeTimerRef.current);
    setNotice(message);
    noticeTimerRef.current = window.setTimeout(() => setNotice(""), 1800);
  };

  useEffect(() => () => window.clearTimeout(noticeTimerRef.current), []);

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
          onClick={() => showNotice("Feed customization is not available yet")}
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
        isEmpty={!data.communities.length}
        emptyText="No communities match your feed yet."
      />
      <CommunityGrid communities={data.communities} />

      <section className="panel for-you-panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">For You</span>
            <h3>Across your games</h3>
          </div>
          <button
            className="text-btn"
            onClick={() => showNotice("Feed tuning is not available yet")}
            type="button"
          >
            Tune Feed <FiChevronRight />
          </button>
        </div>
        <p className="feed-copy">
          A mixed feed from every active game community, ready to connect to personalized backend
          recommendations later.
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
            <div className="tabs small">
              {["Hot", "New", "Top"].map((item) => (
                <button
                  type="button"
                  onClick={() => setTab(item)}
                  className={tab === item ? "active" : ""}
                  key={item}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <PostList posts={data.posts} />
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
    </div>
  );
}
