"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { FiAward, FiEdit3, FiGrid, FiLock, FiShare2, FiStar } from "react-icons/fi";
import { useToast } from "../../hooks/useToast";
import { queries } from "../../lib/queries";
import { bannerColor } from "../../lib/profileBanners";
import {
  accountAge,
  compactCount,
  joinedLabel,
  profileToShow,
  type ProfileOwner,
  type UserProfile,
} from "../../lib/profile/profileView";
import { rankName } from "../../lib/economy";
import { Art } from "../Art";
import { AvatarFace } from "../AvatarFace";
import { PostList } from "../PostList";
import { QueryNotice } from "../QueryNotice";
import { glyph } from "../constants";
import { EditProfileDialog } from "./EditProfileDialog";
import { FollowButton } from "./FollowButton";
import { FollowListDialog, type FollowListKind } from "./FollowListDialog";
import "./ProfileSocial.css";

const TABS = ["Posts", "Builds", "Media", "Likes", "About"] as const;
type Tab = (typeof TABS)[number];
// Tabs with nothing behind them yet: they open a "coming soon" panel.
const SOON_TABS: ReadonlySet<Tab> = new Set(["Builds", "Media", "Likes"]);

// Placeholders for stats we do not track yet. Shown as XXX so nobody takes them for real numbers.
const GACHA_STATS = ["Total pulls", "5★ pulls", "Current pity", "Luck rating"];
const BADGES = ["Early supporter", "First post", "Collector"];

/** One profile page for everyone: yours (with Edit) or somebody else's (with Follow). `profile` is the public profile from the server; `me` is your account. */
export function ProfileView({
  profile,
  me,
  isSelf,
}: {
  profile: UserProfile;
  me: ProfileOwner | null | undefined;
  isSelf: boolean;
}) {
  const [tab, setTab] = useState<Tab>("Posts");
  const [editing, setEditing] = useState(false);
  const [openList, setOpenList] = useState<FollowListKind | null>(null);
  const { notice, showNotice } = useToast();
  const editButtonRef = useRef<HTMLButtonElement | null>(null);
  const shown = profileToShow(profile, me, isSelf);
  const posts = useQuery(isSelf ? queries.myPosts() : queries.userPosts(profile.id));
  const items = posts.data?.items || [];
  const counts = profile.counts;
  const bannerFill = bannerColor(shown.bannerPresetId);
  const comingSoon = (what: string) => showNotice(`${what}: coming soon`);

  const shareProfile = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/user/${profile.id}`);
      showNotice("Profile link copied");
    } catch {
      showNotice("Could not copy the profile link");
    }
  };

  return (
    <div className="page profile-page profile-v2">
      <div className="toast-slot" aria-live="polite">
        {notice}
      </div>
      <div className="profile-v2-body" aria-hidden={editing ? "true" : undefined}>
        <section className="profile-card">
          <div className="profile-cover" style={bannerFill ? { backgroundColor: bannerFill } : undefined}>
            {bannerFill ? null : <Art tone="indigo">{glyph.sparkle}</Art>}
            <div className="profile-cover-actions">
              <button
                aria-label="Copy profile link"
                className="profile-icon-button"
                onClick={shareProfile}
                type="button"
              >
                <FiShare2 aria-hidden="true" />
              </button>
              {isSelf && (
                <button
                  className="profile-cover-edit"
                  onClick={() => setEditing(true)}
                  ref={editButtonRef}
                  type="button"
                >
                  <FiEdit3 aria-hidden="true" /> Edit Profile
                </button>
              )}
            </div>
          </div>

          <div className="profile-identity-row">
            <div className="profile-identity">
              <div className="profile-card-avatar">
                <AvatarFace
                  fallback={<Art tone="blue">{shown.name?.charAt(0).toUpperCase() || "R"}</Art>}
                  image={shown.image}
                />
              </div>
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
              {profile.followsYou && !isSelf && <p className="follows-you">Follows you</p>}
              {shown.bio && <p className="profile-card-bio">{shown.bio}</p>}
              {!isSelf && (
                <div className="profile-actions" aria-label="Profile actions">
                  {!profile.isBlockedByMe && (
                    <FollowButton
                      followsYou={profile.followsYou}
                      isFollowing={profile.isFollowing}
                      userId={profile.id}
                    />
                  )}
                  {profile.isBlockedByMe && <span className="blocked-note">You blocked this person</span>}
                </div>
              )}
            </div>

            {counts && (
              <div className="profile-card-stats">
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
              </div>
            )}
          </div>
        </section>

        <div className="profile-columns">
          <div className="profile-main-column">
            <div aria-label="Profile sections" className="profile-tabs" role="tablist">
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
                  {SOON_TABS.has(item) && <span className="profile-soon-dot" aria-label="coming soon" />}
                </button>
              ))}
            </div>

            {tab === "Posts" && (
              <div className="profile-posts">
                <QueryNotice isLoading={posts.isLoading} isError={posts.isError} />
                {!posts.isLoading && items.length > 0 && <PostList posts={items} variant="feed" />}
                {!posts.isLoading && !posts.isError && items.length === 0 && (
                  <div className="profile-empty">
                    <b>No posts yet</b>
                    <span>{isSelf ? "Your published posts will appear here." : "Nothing posted yet."}</span>
                  </div>
                )}
              </div>
            )}
            {SOON_TABS.has(tab) && (
              <div className="profile-empty">
                <FiGrid aria-hidden="true" />
                <b>{tab}: coming soon</b>
                <span>This part of the profile is not built yet.</span>
              </div>
            )}
            {tab === "About" && (
              <div className="profile-about-panel">
                <p>{shown.bio || (isSelf ? "Add a bio from Edit Profile." : "No bio yet.")}</p>
                <small>{joinedLabel(profile.createdAt)}</small>
              </div>
            )}
          </div>

          <aside className="profile-side" aria-label="Profile details">
            <section className="profile-side-card">
              <h2>About</h2>
              <dl className="profile-facts">
                <div>
                  <dt>Joined</dt>
                  <dd>{joinedLabel(profile.createdAt).replace("Joined ", "") || "—"}</dd>
                </div>
                <div>
                  <dt>Account age</dt>
                  <dd>{accountAge(profile.createdAt) || "—"}</dd>
                </div>
                <div>
                  <dt>Rank</dt>
                  <dd>{rankName(profile.rank)}</dd>
                </div>
                <div>
                  <dt>Reputation</dt>
                  <dd>{(profile.reputation ?? 0).toLocaleString()}</dd>
                </div>
              </dl>
            </section>

            <button className="profile-side-card profile-soon-card" onClick={() => comingSoon("Gacha stats")} type="button">
              <h2>
                <FiStar aria-hidden="true" /> Gacha stats <span className="profile-soon-tag">Coming soon</span>
              </h2>
              <dl className="profile-facts">
                {GACHA_STATS.map((label) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd className="profile-placeholder">XXX</dd>
                  </div>
                ))}
              </dl>
            </button>

            <button className="profile-side-card profile-soon-card" onClick={() => comingSoon("Favourite games")} type="button">
              <h2>
                Favourite games <span className="profile-soon-tag">Coming soon</span>
              </h2>
              <div className="profile-chips">
                {["XXX", "XXX", "XXX"].map((label, index) => (
                  <span className="profile-placeholder" key={index}>
                    {label}
                  </span>
                ))}
              </div>
            </button>

            <button className="profile-side-card profile-soon-card" onClick={() => comingSoon("Badges")} type="button">
              <h2>
                <FiAward aria-hidden="true" /> Badges <span className="profile-soon-tag">Coming soon</span>
              </h2>
              <ul className="profile-badges">
                {BADGES.map((badge) => (
                  <li key={badge}>
                    <FiLock aria-hidden="true" />
                    {badge}
                  </li>
                ))}
              </ul>
            </button>
          </aside>
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
      {openList && <FollowListDialog kind={openList} onClose={() => setOpenList(null)} userId={profile.id} />}
    </div>
  );
}
