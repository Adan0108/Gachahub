"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { FiEdit3, FiShare2 } from "react-icons/fi";
import { useToast } from "../../hooks/useToast";
import { queries } from "../../lib/queries";
import { bannerColor } from "../../lib/profileBanners";
import { compactCount, joinedLabel, profileToShow } from "../../lib/profile/profileView";
import { Art } from "../Art";
import { AvatarFace } from "../AvatarFace";
import { PostList } from "../PostList";
import { QueryNotice } from "../QueryNotice";
import { glyph } from "../constants";
import { EditProfileDialog } from "./EditProfileDialog";
import { FollowButton } from "./FollowButton";
import { FollowListDialog } from "./FollowListDialog";
import "./ProfileSocial.css";

const TABS = ["Posts", "About"];

/** One profile page for everyone: yours (with Edit) or somebody else's (with Follow). `profile` is the public profile from the server; `me` is your account. */
export function ProfileView({ profile, me, isSelf }) {
  const [tab, setTab] = useState("Posts");
  const [editing, setEditing] = useState(false);
  const [openList, setOpenList] = useState(null);
  const { notice, showNotice } = useToast();
  const editButtonRef = useRef(null);
  const shown = profileToShow(profile, me, isSelf);
  const posts = useQuery(isSelf ? queries.myPosts() : queries.userPosts(profile.id));
  const items = posts.data?.items || [];
  const counts = profile.counts;
  const bannerFill = bannerColor(shown.bannerPresetId);

  const shareProfile = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/user/${profile.id}`);
      showNotice("Profile link copied");
    } catch {
      showNotice("Could not copy the profile link");
    }
  };

  return (
    <div className="page profile-page">
      <div className="toast-slot" aria-live="polite">
        {notice}
      </div>
      <div aria-hidden={editing ? "true" : undefined}>
        <section className={`profile-hero ${bannerFill ? "profile-hero-solid" : ""}`}>
          {bannerFill ? (
            <div className="profile-banner-solid" style={{ backgroundColor: bannerFill }} />
          ) : (
            <Art tone="indigo">{glyph.sparkle}</Art>
          )}
          {isSelf && (
            <button
              className="edit-profile"
              onClick={() => setEditing(true)}
              ref={editButtonRef}
              type="button"
            >
              <FiEdit3 /> Edit Profile
            </button>
          )}
          <div className="profile-main">
            <div className="profile-avatar">
              <AvatarFace
                fallback={<Art tone="blue">{shown.name?.charAt(0).toUpperCase() || "R"}</Art>}
                image={shown.image}
              />
            </div>
            <div>
              <h1>{shown.name}</h1>
              {shown.username ? (
                <p className="profile-handle">@{shown.username}</p>
              ) : (
                isSelf && (
                  <p className="profile-handle">
                    <Link href="/onboarding">Claim your @handle</Link>
                  </p>
                )
              )}
              {shown.bio && <blockquote>{shown.bio}</blockquote>}
              {profile.followsYou && !isSelf && <p className="follows-you">Follows you</p>}
              <div className="profile-actions" aria-label="Profile actions">
                {!isSelf && !profile.isBlockedByMe && (
                  <FollowButton
                    followsYou={profile.followsYou}
                    isFollowing={profile.isFollowing}
                    userId={profile.id}
                  />
                )}
                {profile.isBlockedByMe && (
                  <span className="blocked-note">You blocked this person</span>
                )}
                <div className="social">
                  <button aria-label="Copy profile link" onClick={shareProfile} type="button">
                    <FiShare2 aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {counts && (
          <section className="profile-stats profile-counts">
            <div>
              <b>{compactCount(counts.posts)}</b>
              <span>Posts</span>
            </div>
            <button onClick={() => setOpenList("followers")} type="button">
              <b>{compactCount(counts.followers)}</b>
              <span>Followers</span>
            </button>
            <button onClick={() => setOpenList("following")} type="button">
              <b>{compactCount(counts.following)}</b>
              <span>Following</span>
            </button>
          </section>
        )}

        <div aria-label="Profile sections" className="tabs wide" role="tablist">
          {TABS.map((item) => (
            <button
              aria-selected={tab === item}
              className={tab === item ? "active" : ""}
              key={item}
              onClick={() => setTab(item)}
              role="tab"
              type="button"
            >
              {item}
              {item === "Posts" && counts ? ` (${counts.posts})` : ""}
            </button>
          ))}
        </div>

        <div className="profile-body profile-body-single">
          {tab === "Posts" && (
            <div className="panel profile-posts">
              <QueryNotice isLoading={posts.isLoading} isError={posts.isError} />
              {!posts.isLoading && items.length > 0 && <PostList posts={items} />}
              {!posts.isLoading && !posts.isError && items.length === 0 && (
                <div className="state-card profile-empty-state">
                  <b>No posts yet</b>
                  <span>
                    {isSelf ? "Your published posts will appear here." : "Nothing posted yet."}
                  </span>
                </div>
              )}
            </div>
          )}
          {tab === "About" && (
            <div className="panel profile-about">
              <p>{shown.bio || (isSelf ? "Add a bio from Edit Profile." : "No bio yet.")}</p>
              <small>{joinedLabel(profile.createdAt)}</small>
            </div>
          )}
        </div>
      </div>

      {editing && me && (
        <EditProfileDialog
          onClose={() => setEditing(false)}
          onSaved={() => showNotice("Profile saved")}
          triggerRef={editButtonRef}
          user={me}
        />
      )}
      {openList && (
        <FollowListDialog kind={openList} onClose={() => setOpenList(null)} userId={profile.id} />
      )}
    </div>
  );
}
