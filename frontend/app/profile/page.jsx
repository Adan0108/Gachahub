"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { FiCompass, FiEdit3, FiMessageCircle, FiShare2, FiX } from "react-icons/fi";
import { Art } from "../../components/Art";
import { BuildCard } from "../../components/BuildCard";
import { PostList } from "../../components/PostList";
import { QueryNotice } from "../../components/QueryNotice";
import { SectionTitle } from "../../components/SectionTitle";
import { builds, glyph } from "../../components/constants";
import { fallbackPosts } from "../../lib/api";
import { queries } from "../../lib/queries";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const profileTabs = {
  Overview: { title: "Featured work", count: 4 },
  Builds: { title: "Published Builds", count: builds.length },
  Posts: { title: "Recent Posts", count: 3 },
  Collections: { title: "Saved Collections", count: 0 },
  Achievements: { title: "Achievements", count: 3 },
};

const achievements = [
  ["Build Architect", "Published 10 community-rated builds"],
  ["Lore Keeper", "Contributed to 25 verified lore discussions"],
  ["Helpful Rover", "Received 100 helpful reactions"],
];

export default function ProfilePage() {
  const router = useRouter();
  const [tab, setTab] = useState("Builds");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("We ride the waves, chasing the unknown.");
  const [draftName, setDraftName] = useState("");
  const [draftBio, setDraftBio] = useState("");
  const [notice, setNotice] = useState("");
  const editButtonRef = useRef(null);
  const modalRef = useRef(null);
  const nameInputRef = useRef(null);
  const noticeTimerRef = useRef(null);
  const wasEditingRef = useRef(false);
  const profile = useQuery(queries.profile());
  const displayName = name || profile.data?.name || "RoverX";
  const recentPosts = fallbackPosts().slice(0, 3);
  const activeTab = profileTabs[tab];

  const flashNotice = (message) => {
    window.clearTimeout(noticeTimerRef.current);
    setNotice(message);
    noticeTimerRef.current = window.setTimeout(() => setNotice(""), 1800);
  };

  const shareProfile = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      flashNotice("Profile link copied");
    } catch {
      flashNotice("Could not copy the profile link");
    }
  };

  const openEditor = () => {
    setDraftName(displayName);
    setDraftBio(bio);
    setEditing(true);
  };

  const closeEditor = () => setEditing(false);

  const saveProfile = (event) => {
    event.preventDefault();
    setName(draftName.trim());
    setBio(draftBio.trim() || "We ride the waves, chasing the unknown.");
    flashNotice("Profile saved locally");
    setEditing(false);
  };

  useEffect(() => {
    if (!editing) return undefined;

    nameInputRef.current?.focus();
    const handleModalKeyDown = (event) => {
      if (event.key === "Escape") {
        closeEditor();
        return;
      }

      if (event.key !== "Tab") return;

      const focusableItems = Array.from(
        modalRef.current?.querySelectorAll(focusableSelector) || [],
      ).filter((element) => element.offsetParent !== null);
      const firstItem = focusableItems[0];
      const lastItem = focusableItems.at(-1);

      if (!firstItem || !lastItem) {
        event.preventDefault();
        return;
      }

      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    window.addEventListener("keydown", handleModalKeyDown);
    return () => window.removeEventListener("keydown", handleModalKeyDown);
  }, [editing]);

  useEffect(() => {
    if (editing) {
      wasEditingRef.current = true;
      return;
    }

    if (wasEditingRef.current) {
      editButtonRef.current?.focus();
      wasEditingRef.current = false;
    }
  }, [editing]);

  useEffect(() => () => window.clearTimeout(noticeTimerRef.current), []);

  return (
    <div className="page profile-page">
      <div className="toast-slot" aria-live="polite">
        {notice}
      </div>
      <QueryNotice isLoading={profile.isLoading} isError={profile.isError} />
      <div aria-hidden={editing ? "true" : undefined}>
        <section className="profile-hero">
          <Art tone="indigo">{glyph.sparkle}</Art>
          <button ref={editButtonRef} className="edit-profile" onClick={openEditor} type="button">
            <FiEdit3 /> Edit Profile
          </button>
          <div className="profile-main">
            <div className="profile-avatar">
              <Art tone="blue">{displayName.charAt(0).toUpperCase() || "R"}</Art>
            </div>
            <div>
              <h1>
                {displayName} <span className="verified">{glyph.check}</span>
              </h1>
              <p>{profile.data?.email || "UID: 9008420"}</p>
              <blockquote>&quot;{bio}&quot;</blockquote>
              <div className="social" aria-label="Profile actions">
                <button aria-label="Copy profile link" onClick={shareProfile} type="button">
                  <FiShare2 aria-hidden="true" />
                </button>
                <button
                  aria-label="Messaging coming soon"
                  disabled
                  title="Messaging coming soon"
                  type="button"
                >
                  <FiMessageCircle aria-hidden="true" />
                </button>
                <button
                  aria-label="Explore communities"
                  onClick={() => router.push("/explore")}
                  type="button"
                >
                  <FiCompass aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </section>
        <section className="profile-stats">
          <div>
            <b>128</b>
            <span>Posts</span>
          </div>
          <div>
            <b>24.7K</b>
            <span>Reputation</span>
          </div>
          <div>
            <b>412</b>
            <span>Followers</span>
          </div>
          <div>
            <b>89</b>
            <span>Following</span>
          </div>
          <aside className="reputation">
            <div>
              <small>Reputation Level</small>
              <strong>24</strong>
              <b>Elder Voyager</b>
              <div className="progress">
                <i />
              </div>
              <small>8,250 / 12,000</small>
            </div>
            <div className="rank-gem">{glyph.sparkle}</div>
          </aside>
        </section>
        <div aria-label="Profile sections" className="tabs wide" role="tablist">
          {["Overview", "Builds", "Posts", "Collections", "Achievements"].map((item) => (
            <button
              onClick={() => setTab(item)}
              className={tab === item ? "active" : ""}
              key={item}
              aria-selected={tab === item}
              role="tab"
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
        <div className="profile-body">
          <section>
            <SectionTitle>
              {activeTab.title} ({activeTab.count})
            </SectionTitle>
            {(tab === "Overview" || tab === "Builds") && (
              <div className="build-grid">
                {(tab === "Overview" ? builds.slice(0, 2) : builds).map((build, index) => (
                  <BuildCard build={build} index={index} key={build.name} />
                ))}
              </div>
            )}
            {tab === "Posts" && (
              <div className="panel profile-posts">
                <PostList posts={recentPosts} />
              </div>
            )}
            {tab === "Collections" && (
              <div className="state-card profile-empty-state">
                <b>No saved collections yet</b>
                <span>Save builds and posts to organize them here.</span>
              </div>
            )}
            {tab === "Achievements" && (
              <div className="achievement-grid">
                {achievements.map(([title, description]) => (
                  <article className="panel achievement-card" key={title}>
                    <span aria-hidden="true">{glyph.diamond}</span>
                    <div>
                      <b>{title}</b>
                      <small>{description}</small>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
          <aside className="panel leaderboard">
            <div className="panel-head">
              <h3>Top Performing Builds</h3>
              <span className="panel-pill">Top 3</span>
            </div>
            {builds.slice(0, 3).map((build, index) => (
              <div className="leader" key={build.name}>
                <span className={`art-${build.tone}`}>{index + 1}</span>
                <div>
                  <b>
                    {build.name} {build.role}
                  </b>
                  <small>
                    {glyph.dot} {build.views}
                  </small>
                </div>
                <strong>#{index + 1}</strong>
              </div>
            ))}
          </aside>
        </div>
      </div>
      {editing && (
        <div className="modal-backdrop" onClick={closeEditor}>
          <form
            aria-modal="true"
            className="modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={saveProfile}
            ref={modalRef}
            role="dialog"
          >
            <div className="panel-head">
              <h2>Edit profile</h2>
              <button aria-label="Close edit profile" type="button" onClick={closeEditor}>
                <FiX />
              </button>
            </div>
            <label>
              Display name
              <input
                ref={nameInputRef}
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
              />
            </label>
            <label>
              Bio
              <textarea value={draftBio} onChange={(event) => setDraftBio(event.target.value)} />
            </label>
            <button className="primary" type="submit">
              Save changes
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
