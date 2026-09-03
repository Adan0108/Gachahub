"use client";

import { useState } from "react";
import { FiLayers } from "react-icons/fi";

const summaries = [
  [
    "Patch Watch",
    "Version 2.2 chatter is focused on Tethys System routes, Echo tuning, and banner planning.",
  ],
  [
    "Community Pulse",
    "Build posts are outperforming lore posts today, with Sanhua and Changli getting the most saves.",
  ],
  [
    "Lore Digest",
    "Players are connecting the Lament, Sentinels, and Rover memory fragments into one big theory thread.",
  ],
];

export default function SummariesPage() {
  const [generation, setGeneration] = useState(0);
  const [generatedAt, setGeneratedAt] = useState("Ready to refresh");

  const generateSummary = () => {
    setGeneration((current) => current + 1);
    setGeneratedAt("Updated just now from local community data");
  };

  return (
    <div className="page summaries-page">
      <section className="welcome hero-polish summary-hero">
        <div>
          <span className="eyebrow">AI Summaries</span>
          <h1>Your fandom feed, compressed into signal.</h1>
          <p>
            Catch up on community trends, patch chatter, build ideas, and lore highlights at a
            glance.
          </p>
        </div>
        <button className="soft-btn" onClick={generateSummary} type="button">
          <FiLayers /> {generation ? "Refresh Summary" : "Generate Summary"}
        </button>
      </section>
      <div className="summary-status" aria-live="polite">
        {generatedAt}
      </div>
      <div className="summary-grid">
        {summaries.map(([title, summary], index) => (
          <section className="panel ai-panel summary-card" key={title}>
            <div className="panel-head">
              <h3>{title}</h3>
              <span className="beta">{["LIVE", "AI", "NEW"][index]}</span>
            </div>
            <p>{summary}</p>
            <div className="summary-meter">
              <i style={{ width: `${Math.min(92, 74 - index * 12 + generation * 3)}%` }} />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
