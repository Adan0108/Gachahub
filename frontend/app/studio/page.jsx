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
  Inter: '"Inter", "Segoe UI", sans-serif',
  Display: '"Space Grotesk", "Inter", sans-serif',
};

const STORAGE_KEY = "gachahub-studio-settings";
const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export default function StudioPage() {
  const [accent, setAccent] = useState("#8b5cf6");
  const [particles, setParticles] = useState(true);
  const [rarity, setRarity] = useState(true);
  const [size, setSize] = useState("16:9");
  const [font, setFont] = useState("Inter");
  const [activeTool, setActiveTool] = useState("Template");
  const [saved, setSaved] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [notice, setNotice] = useState("");
  const timerRef = useRef(null);
  const previewButtonRef = useRef(null);
  const previewModalRef = useRef(null);
  const wasPreviewingRef = useRef(false);

  const flash = (message) => {
    window.clearTimeout(timerRef.current);
    setNotice(message);
    timerRef.current = window.setTimeout(() => setNotice(""), 1800);
  };

  const save = () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ accent, particles, rarity, size, font, activeTool }),
    );
    window.clearTimeout(timerRef.current);
    setSaved(true);
    setNotice("Saved locally");
    timerRef.current = window.setTimeout(() => {
      setSaved(false);
      setNotice("");
    }, 1600);
  };

  const chooseTool = (item) => {
    setActiveTool(item);
    flash(`${item} tool selected`);
  };

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const settings = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
        if (!settings) return;
        if (Object.keys(canvasSizes).includes(settings.size)) setSize(settings.size);
        if (Object.keys(canvasFonts).includes(settings.font)) setFont(settings.font);
        if (typeof settings.accent === "string") setAccent(settings.accent);
        if (typeof settings.particles === "boolean") setParticles(settings.particles);
        if (typeof settings.rarity === "boolean") setRarity(settings.rarity);
        if (typeof settings.activeTool === "string") setActiveTool(settings.activeTool);
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!previewing) return undefined;

    const closeButton = previewModalRef.current?.querySelector("button");
    closeButton?.focus();

    const handlePreviewKeyDown = (event) => {
      if (event.key === "Escape") {
        setPreviewing(false);
        return;
      }

      if (event.key !== "Tab") return;

      const focusableItems = Array.from(
        previewModalRef.current?.querySelectorAll(focusableSelector) || [],
      ).filter((element) => element.offsetParent !== null);
      const firstItem = focusableItems[0];
      const lastItem = focusableItems.at(-1);

      if (!firstItem || !lastItem) {
        event.preventDefault();
        return;
      }

      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    window.addEventListener("keydown", handlePreviewKeyDown);
    return () => window.removeEventListener("keydown", handlePreviewKeyDown);
  }, [previewing]);

  useEffect(() => {
    if (previewing) {
      wasPreviewingRef.current = true;
      return;
    }

    if (wasPreviewingRef.current) {
      previewButtonRef.current?.focus();
      wasPreviewingRef.current = false;
    }
  }, [previewing]);

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
          <button
            aria-pressed={activeTool === item}
            className={activeTool === item ? "active" : ""}
            key={item}
            onClick={() => chooseTool(item)}
            type="button"
          >
            <Icon />
            {item}
          </button>
        ))}
        <div className="studio-spacer" />
        <button ref={previewButtonRef} onClick={() => setPreviewing(true)} type="button">
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
          <span>Live</span>
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
          <option>Inter</option>
          <option>Display</option>
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
            setFont("Inter");
            flash("Canvas settings reset");
          }}
          type="button"
        >
          Reset All
        </button>
      </aside>
      {previewing && (
        <div
          className="modal-backdrop studio-preview-backdrop"
          onClick={() => setPreviewing(false)}
        >
          <div
            aria-label="Build canvas preview"
            aria-modal="true"
            className="studio-preview-modal"
            onClick={(event) => event.stopPropagation()}
            ref={previewModalRef}
            role="dialog"
          >
            <button
              aria-label="Close preview"
              className="studio-preview-close"
              onClick={() => setPreviewing(false)}
              type="button"
            >
              <FiX />
            </button>
            <div className="studio-preview-copy">
              <span className="eyebrow">Preview</span>
              <b>Sanhua build card</b>
              <small>
                {size} canvas · {font} type
              </small>
            </div>
            <div className="studio-preview-frame">
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
                    {rarity && <div className="stars">{glyph.star.repeat(5)}</div>}
                  </div>
                </div>
                <Art tone="violet" className="canvas-character">
                  {glyph.snow}
                </Art>
                <div className="set-bonus">
                  <b>{glyph.snow} Frost Seeker</b>
                  <p>Glacio DMG +10% · Crit Rate 72.4%</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
