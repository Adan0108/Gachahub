import { useEffect, useState } from "react";
import { BrowserRouter, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  FiBell, FiBookOpen, FiBox, FiChevronRight, FiCompass, FiEdit3, FiGrid,
  FiHeart, FiHome, FiImage, FiLayers, FiMenu, FiMessageCircle, FiPlus,
  FiSearch, FiSettings, FiShare2, FiShield, FiStar, FiTool, FiUsers, FiX,
} from "react-icons/fi";
import { api } from "./services/api";
import "./App.css";

const glyph = {
  sparkle: "\u2726",
  star: "\u2605",
  diamond: "\u25c7",
  moon: "\u263e",
  sword: "\u2694",
  snow: "\u2744",
  dot: "\u25c9",
  check: "\u2713",
};

const art = ["violet", "blue", "amber", "rose", "cyan", "indigo"];
const builds = [
  { name: "Sanhua", role: "Main DPS", tone: "violet", likes: "97%", views: "2.3K", icon: glyph.snow },
  { name: "Jiyan", role: "Hypercarry", tone: "cyan", likes: "95%", views: "1.8K", icon: glyph.sword },
  { name: "Changli", role: "Fusion Burst", tone: "rose", likes: "93%", views: "1.6K", icon: glyph.sparkle },
  { name: "Calcharo", role: "Lightning DPS", tone: "indigo", likes: "94%", views: "1.2K", icon: "\u03df" },
];

function Logo() {
  return <div className="brand"><span className="brand-mark">{glyph.sparkle}</span><b>GachaHub</b><em>AI</em></div>;
}

const nav = [
  ["/", FiHome, "Home"],
  ["/community", FiUsers, "Communities"],
  ["/explore", FiCompass, "Explore"],
  ["/summaries", FiLayers, "AI Summaries"],
  ["/studio", FiTool, "Build Studio"],
  ["/lore", FiBookOpen, "Lore Library"],
];

function Sidebar({ open, close }) {
  return <>
    <div className={`scrim ${open ? "show" : ""}`} onClick={close} />
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <button className="mobile-close" onClick={close}><FiX /></button>
      <Logo />
      <nav className="side-nav">
        {nav.map(([to, Icon, label], i) => (
          <NavLink key={`${label}-${i}`} to={to} end={to === "/"} onClick={close} className={({ isActive }) => isActive ? "active" : ""}>
            <Icon /><span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="side-label">FAVORITES</div>
      <div className="favorites">
        <button onClick={close}>{glyph.dot} <span>Wuthering Waves</span></button>
        <button>{glyph.sparkle} <span>Honkai: Star Rail</span></button>
        <button>{glyph.star} <span>Genshin Impact</span></button>
      </div>
      <div className="pro-card">
        <div className="pro-gem">{glyph.diamond}</div>
        <b>GachaHub AI Pro</b>
        <p>Exclusive AI tools, premium build cards, and smarter summaries.</p>
        <button>Upgrade Now</button>
      </div>
    </aside>
  </>;
}

function Topbar({ onMenu }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const submit = event => {
    event.preventDefault();
    if (query.trim()) navigate(`/explore?q=${encodeURIComponent(query)}`);
  };

  return <header className="topbar">
    <button className="menu-btn" onClick={onMenu}><FiMenu /></button>
    <form className="search" onSubmit={submit}>
      <FiSearch />
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search games, characters, posts..." />
      <kbd>Ctrl K</kbd>
    </form>
    <div className="top-actions">
      <button className="outline-btn" onClick={() => navigate("/studio")}><FiPlus /> <span>Create</span></button>
      <button className="icon-btn" aria-label="Notifications"><FiBell /><i /></button>
      <button className="mini-avatar" onClick={() => navigate("/profile")}>R</button>
    </div>
  </header>;
}

function Art({ tone = "violet", children, className = "" }) {
  return <div className={`art art-${tone} ${className}`}>
    <div className="moon" />
    <div className="silhouette">{children || glyph.sparkle}</div>
    <div className="art-lines" />
  </div>;
}

function SectionTitle({ children, action }) {
  return <div className="section-title">
    <h2>{children}</h2>
    {action && <button>{action} <FiChevronRight /></button>}
  </div>;
}

function HomePage() {
  const navigate = useNavigate();
  const [data, setData] = useState({ communities: [], posts: [] });
  const [tab, setTab] = useState("Hot");

  useEffect(() => { api.getHome().then(setData); }, []);

  return <div className="page home-page">
    <section className="welcome hero-polish">
      <div>
        <span className="eyebrow">Today on GachaHub</span>
        <h1>Welcome back, Rover <span>{glyph.sparkle}</span></h1>
        <p>Explore communities, discover builds, and uncover the lore.</p>
      </div>
      <button className="soft-btn"><FiSettings /> Customize Feed</button>
    </section>

    <SectionTitle action="View All">Game Communities</SectionTitle>
    <div className="community-grid">
      {data.communities.map((community, i) => (
        <button className="community-card" key={community.id} onClick={() => navigate("/community")}>
          <Art tone={art[i % art.length]}>{community.symbol}</Art>
          <div><b>{community.name}</b><span>{community.members} Members</span></div>
        </button>
      ))}
    </div>

    <div className="dashboard-grid">
      <section className="panel trending">
        <div className="panel-head">
          <h3>Trending Posts</h3>
          <div className="tabs small">{["Hot", "New", "Top"].map(item => <button onClick={() => setTab(item)} className={tab === item ? "active" : ""} key={item}>{item}</button>)}</div>
        </div>
        <div className="post-list">
          {data.posts.map((post, i) => (
            <article className="post" key={post.id}>
              <span className="rank">{i + 1}</span>
              <div className={`post-thumb art-${art[i]}`}>{glyph.sparkle}</div>
              <div><b>{post.title}</b><small>{post.author} - {post.time}</small></div>
              <span className="tag">{post.tag}</span>
            </article>
          ))}
        </div>
        <button className="text-btn">View All Trending <FiChevronRight /></button>
      </section>

      <div className="stack">
        <section className="panel ai-panel">
          <div className="panel-head"><h3>AI Summary</h3><span className="beta">BETA</span></div>
          <p>Here&apos;s what&apos;s happening across your communities.</p>
          <ul>
            <li>Version 2.2 introduces a new region, <b>&quot;Tethys System&quot;</b>.</li>
            <li>Sanhua and Cantarella headline the new banner phase.</li>
            <li>Players discovered hidden Rover interactions.</li>
          </ul>
          <button className="panel-button">View Full Summary</button>
        </section>
        <section className="panel lore">
          <div className="panel-head"><h3>Popular Lore Tags</h3><FiCompass /></div>
          <div className="chips"><span>#TethysSystem</span><span>#Lament</span><span>#Rover</span><span>#Sentinels</span></div>
        </section>
      </div>
    </div>
  </div>;
}

function BuildCard({ build, index = 0 }) {
  return <article className="build-card">
    <Art tone={build.tone}>{build.icon || builds[index % builds.length].icon}</Art>
    <div><b>{build.name}</b><span>{build.role}</span><small><FiHeart /> {build.likes} - <FiCompass /> {build.views}</small></div>
  </article>;
}

function CommunityPage() {
  const [joined, setJoined] = useState(true);
  const [tab, setTab] = useState("Builds");
  const [community, setCommunity] = useState({
    name: "Wuthering Waves",
    slug: "wuthering-waves",
    members: "32.1K",
    posts: "0",
    description: "A community for Rovers to share builds, theories, lore and everything Wuthering Waves.",
    categories: [],
    symbol: glyph.moon,
  });
  const [categories, setCategories] = useState(["Overview", "Builds", "Teams", "Lore", "Theory", "Guides", "Events", "Media"]);

  useEffect(() => {
    Promise.all([
      api.getCommunity("wuthering-waves"),
      api.getCategories("wuthering-waves").catch(() => []),
    ])
      .then(([game, gameCategories]) => {
        setCommunity(game);
        const categoryNames = gameCategories
          .filter(category => category.isActive !== false)
          .map(category => category.name);
        setCategories(["Overview", ...categoryNames, "Builds", "Teams"].filter((item, index, all) => all.indexOf(item) === index));
      })
      .catch(() => {});
  }, []);

  return <div className="page community-page">
    <section className="community-hero"><Art tone="indigo"><span className="hero-rune">{community.symbol}</span></Art><div className="hero-wordmark">{community.name.toUpperCase()}</div></section>
    <section className="community-info">
      <div className="community-avatar"><Art tone="blue">{community.symbol}</Art></div>
      <div className="community-copy">
        <h1>{community.name} <span className="verified">{glyph.check}</span></h1>
        <p>{community.members} Members - {community.posts} Posts</p>
        <small>{community.description || `A community for ${community.name} players to share builds, theories, lore, and guides.`}</small>
      </div>
      <button className={`join-btn ${joined ? "joined" : ""}`} onClick={() => setJoined(!joined)}>{joined ? `${glyph.check} Joined` : "+ Join"}</button>
      <div className="top-characters"><small>Top Characters</small><div>{art.map((tone, i) => <span className={`character-dot art-${tone}`} key={tone}>{i + 1}</span>)}</div></div>
    </section>
    <div className="tabs wide">{categories.map(item => <button className={tab === item ? "active" : ""} onClick={() => setTab(item)} key={item}>{item}</button>)}</div>
    <div className="community-body">
      <section><SectionTitle action="View All Builds">Featured {tab}</SectionTitle><div className="build-grid">{builds.map((build, i) => <BuildCard build={build} index={i} key={build.name} />)}</div></section>
      <aside className="panel highlights">
        <div className="panel-head"><h3>Community Highlights</h3><FiX /></div>
        {["2.2 Livestream Recap", "Tethys System Map", "Lore Theory Megathread"].map((item, i) => <div className="highlight" key={item}><span>{glyph.sparkle}</span><div><b>{item}</b><small>{["New Echoes, events, and QOL changes coming!", "Interactive map & chest locations.", "Discuss the mysteries of the Lament!"][i]}</small></div></div>)}
      </aside>
    </div>
  </div>;
}

function ExplorePage() {
  const [data, setData] = useState({ communities: [], posts: [] });
  useEffect(() => { api.getHome().then(setData); }, []);

  return <div className="page explore-page">
    <section className="welcome hero-polish explore-hero">
      <div>
        <span className="eyebrow">Discover</span>
        <h1>Explore new builds, theories, and creators.</h1>
        <p>A cleaner discovery page your backend friend can later power with search results, filters, and recommendations.</p>
      </div>
      <button className="soft-btn"><FiCompass /> Smart Explore</button>
    </section>
    <div className="explore-layout">
      <section>
        <SectionTitle action="Refresh">Recommended Communities</SectionTitle>
        <div className="community-grid compact">
          {data.communities.map((community, i) => <button className="community-card" key={community.id}><Art tone={art[i % art.length]}>{community.symbol}</Art><div><b>{community.name}</b><span>{community.members} Members</span></div></button>)}
        </div>
        <SectionTitle action="See More">Fresh Posts</SectionTitle>
        <div className="post-list panel">
          {data.posts.map((post, i) => <article className="post" key={post.id}><span className="rank">{i + 1}</span><div className={`post-thumb art-${art[i]}`}>{glyph.sparkle}</div><div><b>{post.title}</b><small>{post.author} - {post.time}</small></div><span className="tag">{post.tag}</span></article>)}
        </div>
      </section>
      <aside className="panel filter-panel">
        <div className="panel-head"><h3>Explore Filters</h3><FiSettings /></div>
        <div className="chips tall"><span>Guides</span><span>Builds</span><span>Lore</span><span>Fan Art</span><span>Events</span><span>Teams</span></div>
      </aside>
    </div>
  </div>;
}

function SummariesPage() {
  return <div className="page summaries-page">
    <section className="welcome hero-polish summary-hero">
      <div>
        <span className="eyebrow">AI Summaries</span>
        <h1>Your fandom feed, compressed into signal.</h1>
        <p>Mocked for now, but shaped so the backend can connect summary, source, and trend endpoints later.</p>
      </div>
      <button className="soft-btn"><FiLayers /> Generate Summary</button>
    </section>
    <div className="summary-grid">
      {["Patch Watch", "Community Pulse", "Lore Digest"].map((title, i) => <section className="panel ai-panel summary-card" key={title}>
        <div className="panel-head"><h3>{title}</h3><span className="beta">{["LIVE", "AI", "NEW"][i]}</span></div>
        <p>{["Version 2.2 chatter is focused on Tethys System routes, Echo tuning, and banner planning.", "Build posts are outperforming lore posts today, with Sanhua and Changli getting the most saves.", "Players are connecting the Lament, Sentinels, and Rover memory fragments into one big theory thread."][i]}</p>
        <div className="summary-meter"><i style={{ width: `${74 - i * 12}%` }} /></div>
      </section>)}
    </div>
  </div>;
}

function LorePage() {
  return <div className="page lore-page">
    <section className="welcome hero-polish lore-hero">
      <div>
        <span className="eyebrow">Lore Library</span>
        <h1>Track the mysteries behind the waves.</h1>
        <p>Browse tags, saved theories, and story threads in a page that feels distinct from the community feed.</p>
      </div>
      <button className="soft-btn"><FiBookOpen /> Open Archive</button>
    </section>
    <div className="lore-grid">
      {["The Lament", "Tethys System", "Sentinels", "Rover Memories"].map((topic, i) => <article className="panel lore-card" key={topic}>
        <Art tone={art[i]}>{glyph.sparkle}</Art>
        <div><span className="eyebrow">Archive {String(i + 1).padStart(2, "0")}</span><h3>{topic}</h3><p>{["A running theory board for the catastrophe that reshaped Solaris-3.", "Signals, terminals, and strange ruins tied to the newest region.", "Fragments about guardians, authority, and old-world protection systems.", "Collected clues about identity, memory loss, and repeating cycles."][i]}</p></div>
      </article>)}
    </div>
  </div>;
}

const toolItems = [[FiGrid, "Template"], [FiImage, "Background"], [FiStar, "Particles"], [FiLayers, "Effects"], [FiEdit3, "Text"], [FiBox, "Frame"], [FiShield, "Decorations"]];

function StudioPage() {
  const [accent, setAccent] = useState("#8b5cf6");
  const [particles, setParticles] = useState(true);
  const [rarity, setRarity] = useState(true);
  const [saved, setSaved] = useState(false);
  const save = () => { setSaved(true); setTimeout(() => setSaved(false), 1600); };

  return <div className="studio-page">
    <aside className="studio-tools"><div className="studio-title"><b>Build Canvas</b><button onClick={save}>{saved ? "Saved!" : "Save"}</button></div><small>Untitled Build</small>{toolItems.map(([Icon, item]) => <button key={item}><Icon />{item}</button>)}<div className="studio-spacer" /><button><FiCompass /> Preview</button><button className="export" onClick={() => window.print()}>Export Image</button></aside>
    <main className="canvas-wrap">
      <div className={`build-canvas ${particles ? "particles-on" : ""}`} style={{ "--accent": accent }}>
        <div className="canvas-header"><div className="char-badge">{glyph.sparkle}</div><div><h1>Sanhua</h1><p>Lv. 90 / 90</p><div className="stars">{glyph.star}{glyph.star}{glyph.star}{glyph.star}{glyph.star}</div></div></div>
        <div className="stats">{[["HP", "15420"], ["ATK", "2456"], ["DEF", "1357"], ["Crit. Rate", "72.4%"], ["Crit. DMG", "248.6%"], ["Energy Regen", "127.6%"], ["Resonance Skill DMG", "22.3%"]].map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
        <Art tone="violet" className="canvas-character">{glyph.snow}</Art>
        <div className="equipment"><b>Equipment</b><div className="weapon">{glyph.sword} <span>Emerald of Genesis<br /><small>Lv. 90</small></span></div><b>Echoes <small>12/12</small></b><div className="echo-grid">{[1, 2, 3, 4, 5, 6].map(item => <span key={item}>{glyph.diamond}</span>)}</div></div>
        <div className="set-bonus"><b>{glyph.snow} Frost Seeker</b><p>(2-Piece) Glacio DMG +10%</p><p>(5-Piece) Using Basic Attack increases Glacio DMG.</p></div>
      </div>
    </main>
    <aside className="canvas-settings"><div className="panel-head"><b>Canvas Settings</b><FiX /></div><label>Theme</label><div className="color-row">{["#8b5cf6", "#56c7ff", "#ef62a6", "#f6b54a"].map(color => <button onClick={() => setAccent(color)} style={{ background: color }} className={accent === color ? "selected" : ""} key={color} />)}</div><label>Size</label><div className="segmented"><button className="active">16:9</button><button>4:3</button><button>1:1</button></div><label>Font</label><select><option>Orbitron</option><option>Inter</option></select><Toggle label="Show Rarity" value={rarity} setValue={setRarity} /><Toggle label="Show Particles" value={particles} setValue={setParticles} /><button className="reset" onClick={() => { setAccent("#8b5cf6"); setParticles(true); }}>Reset All</button></aside>
  </div>;
}

function Toggle({ label, value, setValue }) {
  return <div className="toggle-row"><span>{label}</span><button className={`toggle ${value ? "on" : ""}`} onClick={() => setValue(!value)}><i /></button></div>;
}

function ProfilePage() {
  const [tab, setTab] = useState("Builds");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("RoverX");

  return <div className="page profile-page">
    <section className="profile-hero"><Art tone="indigo">{glyph.sparkle}</Art><button className="edit-profile" onClick={() => setEditing(true)}><FiEdit3 /> Edit Profile</button><div className="profile-main"><div className="profile-avatar"><Art tone="blue">R</Art></div><div><h1>{name} <span className="verified">{glyph.check}</span></h1><p>UID: 9008420</p><blockquote>&quot;We ride the waves, chasing the unknown.&quot;</blockquote><div className="social"><FiShare2 /><FiMessageCircle /><FiCompass /></div></div></div></section>
    <section className="profile-stats"><div><b>128</b><span>Posts</span></div><div><b>24.7K</b><span>Reputation</span></div><div><b>412</b><span>Followers</span></div><div><b>89</b><span>Following</span></div><aside className="reputation"><div><small>Reputation Level</small><strong>24</strong><b>Elder Voyager</b><div className="progress"><i /></div><small>8,250 / 12,000</small></div><div className="rank-gem">{glyph.sparkle}</div></aside></section>
    <div className="tabs wide">{["Overview", "Builds", "Posts", "Collections", "Achievements"].map(item => <button onClick={() => setTab(item)} className={tab === item ? "active" : ""} key={item}>{item}</button>)}</div>
    <div className="profile-body"><section><SectionTitle>Published {tab} (12)</SectionTitle><div className="build-grid">{builds.map((build, i) => <BuildCard build={build} index={i} key={build.name} />)}</div></section><aside className="panel leaderboard"><div className="panel-head"><h3>Top Performing Builds</h3><FiX /></div>{builds.slice(0, 3).map((build, i) => <div className="leader" key={build.name}><span className={`art-${build.tone}`}>{i + 1}</span><div><b>{build.name} {build.role}</b><small>{glyph.dot} {build.views}</small></div><strong>#{i + 1}</strong></div>)}</aside></div>
    {editing && <div className="modal-backdrop" onClick={() => setEditing(false)}><form className="modal" onClick={event => event.stopPropagation()} onSubmit={event => { event.preventDefault(); setEditing(false); }}><div className="panel-head"><h2>Edit profile</h2><button type="button" onClick={() => setEditing(false)}><FiX /></button></div><label>Display name<input value={name} onChange={event => setName(event.target.value)} /></label><label>Bio<textarea defaultValue="We ride the waves, chasing the unknown." /></label><button className="primary">Save changes</button></form></div>}
  </div>;
}

function Shell() {
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  const studio = location.pathname === "/studio";
  return <div className={`app-shell ${studio ? "studio-shell" : ""}`}><Sidebar open={menu} close={() => setMenu(false)} /><div className="main-column">{!studio && <Topbar onMenu={() => setMenu(true)} />}<Routes><Route path="/" element={<HomePage />} /><Route path="/community" element={<CommunityPage />} /><Route path="/explore" element={<ExplorePage />} /><Route path="/summaries" element={<SummariesPage />} /><Route path="/lore" element={<LorePage />} /><Route path="/studio" element={<StudioPage />} /><Route path="/profile" element={<ProfilePage />} /></Routes></div></div>;
}

export default function App() {
  return <BrowserRouter><Shell /></BrowserRouter>;
}
