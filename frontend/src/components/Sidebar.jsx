import {
  FaHome,
  FaUsers,
  FaCompass,
  FaRobot,
  FaHammer,
  FaBook,
  FaTools,
} from "react-icons/fa";

function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="logo">
        <span>✦</span>
        GachaHub AI
      </div>

      <nav>
  <button className="active">
    <FaHome />
    Home
  </button>

  <button>
    <FaUsers />
    Communities
  </button>

  <button>
    <FaCompass />
    Explore
  </button>

  <button>
    <FaRobot />
    AI Summaries
  </button>

  <button>
    <FaHammer />
    Build Studio
  </button>

  <button>
    <FaBook />
    Lore Library
  </button>

  <button>
    <FaTools />
    Tools
  </button>
</nav>
      <div className="favorites">
  <h4>FAVORITES</h4>

  <p>🌊 Wuthering Waves</p>
  <p>🚂 Honkai Star Rail</p>
  <p>✨ Genshin Impact</p>
</div>

<div className="pro-card">
  <h3>GachaHub AI Pro</h3>

  <p>
    Upgrade for exclusive AI tools and more.
  </p>

  <button>Upgrade Now</button>
</div>
    </aside>
  );
}

export default Sidebar;

