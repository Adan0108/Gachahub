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
  return (
    <div className="page lore-page">
      <section className="welcome hero-polish lore-hero">
        <div>
          <span className="eyebrow">Lore Library</span>
          <h1>Track the mysteries behind the waves.</h1>
          <p>Browse tags, saved theories, and story threads in a page that feels distinct from the community feed.</p>
        </div>
        <button className="soft-btn" type="button"><FiBookOpen /> Open Archive</button>
      </section>
      <div className="lore-grid">
        {loreTopics.map(([topic, description], index) => (
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
    </div>
  );
}
