"use client";

import { useState } from "react";
import { FiCompass, FiX } from "react-icons/fi";
import { Art } from "../../components/Art";
import { glyph, toolItems } from "../../components/constants";

function Toggle({ label, value, setValue }) {
  return (
    <div className="toggle-row">
      <span>{label}</span>
      <button className={`toggle ${value ? "on" : ""}`} onClick={() => setValue(!value)} type="button"><i /></button>
    </div>
  );
}

export default function StudioPage() {
  const [accent, setAccent] = useState("#8b5cf6");
  const [particles, setParticles] = useState(true);
  const [rarity, setRarity] = useState(true);
  const [saved, setSaved] = useState(false);
  const save = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  return (
    <div className="studio-page">
      <aside className="studio-tools">
        <div className="studio-title"><b>Build Canvas</b><button onClick={save} type="button">{saved ? "Saved!" : "Save"}</button></div>
        <small>Untitled Build</small>
        {toolItems.map(([Icon, item]) => <button key={item} type="button"><Icon />{item}</button>)}
        <div className="studio-spacer" />
        <button type="button"><FiCompass /> Preview</button>
        <button className="export" onClick={() => window.print()} type="button">Export Image</button>
      </aside>
      <main className="canvas-wrap">
        <div className={`build-canvas ${particles ? "particles-on" : ""}`} style={{ "--accent": accent }}>
          <div className="canvas-header"><div className="char-badge">{glyph.sparkle}</div><div><h1>Sanhua</h1><p>Lv. 90 / 90</p><div className="stars">{glyph.star}{glyph.star}{glyph.star}{glyph.star}{glyph.star}</div></div></div>
          <div className="stats">{[["HP", "15420"], ["ATK", "2456"], ["DEF", "1357"], ["Crit. Rate", "72.4%"], ["Crit. DMG", "248.6%"], ["Energy Regen", "127.6%"], ["Resonance Skill DMG", "22.3%"]].map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
          <Art tone="violet" className="canvas-character">{glyph.snow}</Art>
          <div className="equipment"><b>Equipment</b><div className="weapon">{glyph.sword} <span>Emerald of Genesis<br /><small>Lv. 90</small></span></div><b>Echoes <small>12/12</small></b><div className="echo-grid">{[1, 2, 3, 4, 5, 6].map(item => <span key={item}>{glyph.diamond}</span>)}</div></div>
          <div className="set-bonus"><b>{glyph.snow} Frost Seeker</b><p>(2-Piece) Glacio DMG +10%</p><p>(5-Piece) Using Basic Attack increases Glacio DMG.</p></div>
        </div>
      </main>
      <aside className="canvas-settings">
        <div className="panel-head"><b>Canvas Settings</b><FiX /></div>
        <label>Theme</label>
        <div className="color-row">{["#8b5cf6", "#56c7ff", "#ef62a6", "#f6b54a"].map(color => <button onClick={() => setAccent(color)} style={{ background: color }} className={accent === color ? "selected" : ""} key={color} type="button" />)}</div>
        <label>Size</label>
        <div className="segmented"><button className="active" type="button">16:9</button><button type="button">4:3</button><button type="button">1:1</button></div>
        <label>Font</label>
        <select><option>Orbitron</option><option>Inter</option></select>
        <Toggle label="Show Rarity" value={rarity} setValue={setRarity} />
        <Toggle label="Show Particles" value={particles} setValue={setParticles} />
        <button className="reset" onClick={() => { setAccent("#8b5cf6"); setParticles(true); }} type="button">Reset All</button>
      </aside>
    </div>
  );
}
