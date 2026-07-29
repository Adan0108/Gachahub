import { FiLayers } from "react-icons/fi";

export default function SummariesPage() {
  return (
    <div className="page summaries-page">
      <section className="welcome hero-polish summary-hero">
        <div>
          <span className="eyebrow">AI Summaries</span>
          <h1>Your fandom feed, compressed into signal.</h1>
          <p>Catch up on community trends, patch chatter, build ideas, and lore highlights at a glance.</p>
        </div>
        <button className="soft-btn" type="button"><FiLayers /> Generate Summary</button>
      </section>
      <div className="summary-grid">
        {["Patch Watch", "Community Pulse", "Lore Digest"].map((title, index) => (
          <section className="panel ai-panel summary-card" key={title}>
            <div className="panel-head"><h3>{title}</h3><span className="beta">{["LIVE", "AI", "NEW"][index]}</span></div>
            <p>{["Version 2.2 chatter is focused on Tethys System routes, Echo tuning, and banner planning.", "Build posts are outperforming lore posts today, with Sanhua and Changli getting the most saves.", "Players are connecting the Lament, Sentinels, and Rover memory fragments into one big theory thread."][index]}</p>
            <div className="summary-meter"><i style={{ width: `${74 - index * 12}%` }} /></div>
          </section>
        ))}
      </div>
    </div>
  );
}
