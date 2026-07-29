"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FiCompass, FiEdit3, FiMessageCircle, FiShare2, FiX } from "react-icons/fi";
import { Art } from "../../components/Art";
import { BuildCard } from "../../components/BuildCard";
import { QueryNotice } from "../../components/QueryNotice";
import { SectionTitle } from "../../components/SectionTitle";
import { builds, glyph } from "../../components/constants";
import { queries } from "../../lib/queries";

export default function ProfilePage() {
  const [tab, setTab] = useState("Builds");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const profile = useQuery(queries.profile());
  const displayName = name || profile.data?.name || "RoverX";

  return (
    <div className="page profile-page">
      <QueryNotice isLoading={profile.isLoading} isError={profile.isError} />
      <section className="profile-hero">
        <Art tone="indigo">{glyph.sparkle}</Art>
        <button className="edit-profile" onClick={() => setEditing(true)} type="button"><FiEdit3 /> Edit Profile</button>
        <div className="profile-main">
          <div className="profile-avatar"><Art tone="blue">{displayName.charAt(0).toUpperCase() || "R"}</Art></div>
          <div>
            <h1>{displayName} <span className="verified">{glyph.check}</span></h1>
            <p>{profile.data?.email || "UID: 9008420"}</p>
            <blockquote>&quot;We ride the waves, chasing the unknown.&quot;</blockquote>
            <div className="social"><FiShare2 /><FiMessageCircle /><FiCompass /></div>
          </div>
        </div>
      </section>
      <section className="profile-stats">
        <div><b>128</b><span>Posts</span></div>
        <div><b>24.7K</b><span>Reputation</span></div>
        <div><b>412</b><span>Followers</span></div>
        <div><b>89</b><span>Following</span></div>
        <aside className="reputation"><div><small>Reputation Level</small><strong>24</strong><b>Elder Voyager</b><div className="progress"><i /></div><small>8,250 / 12,000</small></div><div className="rank-gem">{glyph.sparkle}</div></aside>
      </section>
      <div className="tabs wide">
        {["Overview", "Builds", "Posts", "Collections", "Achievements"].map(item => <button onClick={() => setTab(item)} className={tab === item ? "active" : ""} key={item} type="button">{item}</button>)}
      </div>
      <div className="profile-body">
        <section><SectionTitle>Published {tab} (12)</SectionTitle><div className="build-grid">{builds.map((build, index) => <BuildCard build={build} index={index} key={build.name} />)}</div></section>
        <aside className="panel leaderboard">
          <div className="panel-head"><h3>Top Performing Builds</h3><FiX /></div>
          {builds.slice(0, 3).map((build, index) => <div className="leader" key={build.name}><span className={`art-${build.tone}`}>{index + 1}</span><div><b>{build.name} {build.role}</b><small>{glyph.dot} {build.views}</small></div><strong>#{index + 1}</strong></div>)}
        </aside>
      </div>
      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(false)}>
          <form className="modal" onClick={event => event.stopPropagation()} onSubmit={event => { event.preventDefault(); setEditing(false); }}>
            <div className="panel-head"><h2>Edit profile</h2><button type="button" onClick={() => setEditing(false)}><FiX /></button></div>
            <label>Display name<input value={displayName} onChange={event => setName(event.target.value)} /></label>
            <label>Bio<textarea defaultValue="We ride the waves, chasing the unknown." /></label>
            <button className="primary" type="submit">Save changes</button>
          </form>
        </div>
      )}
    </div>
  );
}
