"use client";

import { useState } from "react";
import { FiBookOpen } from "react-icons/fi";
import { Art } from "../../components/Art";
import { artTones, glyph } from "../../components/constants";

const loreTopics = [
  ["The Lament", "A running theory board for the catastrophe that reshaped Solaris-3."],
  ["Tethys System", "Signals, terminals, and strange ruins tied to the newest region."],
  ["Sentinels", "Fragments about guardians, authority, and old-world protection systems."],
  ["Rover Memories", "Collected clues about identity, memory loss, and repeating cycles."],
];

export default function LorePage() {
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filteredTopics = loreTopics.filter(([topic, description]) =>
    `${topic} ${description}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="page lore-page">
      <section className="welcome hero-polish lore-hero">
        <div>
          <span className="eyebrow">Lore Library</span>
          <h1>Track the mysteries behind the waves.</h1>
          <p>
            Browse tags, saved theories, and story threads in a page that feels distinct from the
            community feed.
          </p>
        </div>
        <button
          className="soft-btn"
          onClick={() => setArchiveOpen((current) => !current)}
          type="button"
        >
          <FiBookOpen /> {archiveOpen ? "Close Archive" : "Open Archive"}
        </button>
      </section>
      {archiveOpen && (
        <section className="panel archive-toolbar" aria-label="Lore archive search">
          <label htmlFor="lore-search">Search the archive</label>
          <input
            id="lore-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search mysteries, characters, or regions"
            type="search"
            value={query}
          />
          <small>{filteredTopics.length} archive entries found</small>
        </section>
      )}
      <div className="lore-grid">
        {filteredTopics.map(([topic, description], index) => (
          <article className="panel lore-card" key={topic}>
            <Art tone={artTones[index]}>{glyph.sparkle}</Art>
            <div>
              <span className="eyebrow">Archive {String(index + 1).padStart(2, "0")}</span>
              <h3>{topic}</h3>
              <p>{description}</p>
            </div>
          </article>
        ))}
      </div>
      {!filteredTopics.length && (
        <div className="state-card">No lore entries match this search.</div>
      )}
    </div>
  );
}
