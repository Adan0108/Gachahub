"use client";

import { useEffect, useRef, useState } from "react";
import { FiCompass, FiX } from "react-icons/fi";
import { Art } from "../../components/Art";
import { glyph, toolItems } from "../../components/constants";

function Toggle({ label, value, setValue }) {
  return (
    <div className="toggle-row">
      <span>{label}</span>
      <button
        aria-label={label}
        aria-pressed={value}
        className={`toggle ${value ? "on" : ""}`}
        onClick={() => setValue(!value)}
        type="button"
      >
        <i />
      </button>
    </div>
  );
}

const canvasSizes = {
  "16:9": "16 / 9",
  "4:3": "4 / 3",
  "1:1": "1 / 1",
};

const canvasFonts = {
  Orbitron: '"Orbitron", "Space Grotesk", sans-serif',
  Inter: '"Inter", "Segoe UI", sans-serif',
};

export default function StudioPage() {
  const [accent, setAccent] = useState("#8b5cf6");
  const [particles, setParticles] = useState(true);
  const [rarity, setRarity] = useState(true);
  const [size, setSize] = useState("16:9");
  const [font, setFont] = useState("Orbitron");
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState("");
  const timerRef = useRef(null);

  const flash = (message) => {
    window.clearTimeout(timerRef.current);
    setNotice(message);
    timerRef.current = window.setTimeout(() => setNotice(""), 1800);
  };

  const save = () => {
    window.clearTimeout(timerRef.current);
    setSaved(true);
    setNotice("Saved locally");
    timerRef.current = window.setTimeout(() => {
      setSaved(false);
      setNotice("");
    }, 1600);
  };

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  return (
    <div className="studio-page">
      <div className="toast-slot" aria-live="polite">
        {notice}
      </div>
      <aside className="studio-tools">
        <div className="studio-title">
          <b>Build Canvas</b>
          <button onClick={save} type="button">
            {saved ? "Saved!" : "Save"}
          </button>
        </div>
        <small>Untitled Build</small>
        {toolItems.map(([Icon, item]) => (
          <button key={item} type="button">
            <Icon />
            {item}
          </button>
        ))}
        <div className="studio-spacer" />
        <button onClick={() => flash("Preview is not available yet")} type="button">
          <FiCompass /> Preview
        </button>
        <button className="export" onClick={() => window.print()} type="button">
          Export Image
        </button>
      </aside>
      <main className="canvas-wrap">
        <div
          className={`build-canvas ${particles ? "particles-on" : ""}`}
          style={{
            "--accent": accent,
            "--canvas-aspect-ratio": canvasSizes[size],
            "--canvas-font": canvasFonts[font],
          }}
        >
          <div className="canvas-header">
            <div className="char-badge">{glyph.sparkle}</div>
            <div>
              <h1>Sanhua</h1>
              <p>Lv. 90 / 90</p>
              {rarity && (
                <div className="stars" aria-label="5 star rarity">
                  {glyph.star}
                  {glyph.star}
                  {glyph.star}
                  {glyph.star}
                  {glyph.star}
                </div>
              )}
            </div>
          </div>
          <div className="stats">
            {[
              ["HP", "15420"],
              ["ATK", "2456"],
              ["DEF", "1357"],
              ["Crit. Rate", "72.4%"],
              ["Crit. DMG", "248.6%"],
              ["Energy Regen", "127.6%"],
              ["Resonance Skill DMG", "22.3%"],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <b>{value}</b>
              </div>
            ))}
          </div>
          <Art tone="violet" className="canvas-character">
            {glyph.snow}
          </Art>
          <div className="equipment">
            <b>Equipment</b>
            <div className="weapon">
              {glyph.sword}{" "}
              <span>
                Emerald of Genesis
                <br />
                <small>Lv. 90</small>
              </span>
            </div>
            <b>
              Echoes <small>12/12</small>
            </b>
            <div className="echo-grid">
              {[1, 2, 3, 4, 5, 6].map((item) => (
                <span key={item}>{glyph.diamond}</span>
              ))}
            </div>
          </div>
          <div className="set-bonus">
            <b>{glyph.snow} Frost Seeker</b>
            <p>(2-Piece) Glacio DMG +10%</p>
            <p>(5-Piece) Using Basic Attack increases Glacio DMG.</p>
          </div>
        </div>
      </main>
      <aside className="canvas-settings">
        <div className="panel-head">
          <b>Canvas Settings</b>
          <FiX aria-hidden="true" />
        </div>
        <label>Theme</label>
        <div className="color-row">
          {["#8b5cf6", "#56c7ff", "#ef62a6", "#f6b54a"].map((color) => (
            <button
              aria-label={`Use color ${color}`}
              onClick={() => setAccent(color)}
              style={{ background: color }}
              className={accent === color ? "selected" : ""}
              key={color}
              type="button"
            />
          ))}
        </div>
        <label>Size</label>
        <div className="segmented">
          {["16:9", "4:3", "1:1"].map((item) => (
            <button
              aria-pressed={size === item}
              className={size === item ? "active" : ""}
              onClick={() => setSize(item)}
              key={item}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
        <label>Font</label>
        <select value={font} onChange={(event) => setFont(event.target.value)}>
          <option>Orbitron</option>
          <option>Inter</option>
        </select>
        <Toggle label="Show Rarity" value={rarity} setValue={setRarity} />
        <Toggle label="Show Particles" value={particles} setValue={setParticles} />
        <button
          className="reset"
          onClick={() => {
            setAccent("#8b5cf6");
            setParticles(true);
            setRarity(true);
            setSize("16:9");
            setFont("Orbitron");
            flash("Canvas settings reset");
          }}
          type="button"
        >
          Reset All
        </button>
      </aside>
    </div>
  );
}
