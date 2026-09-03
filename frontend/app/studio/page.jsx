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

const exportSizes = {
  "16:9": [1600, 900],
  "4:3": [1200, 900],
  "1:1": [1080, 1080],
};

const backgrounds = [
  { name: "Aurora", start: "#10233b", end: "#090b17" },
  { name: "Abyss", start: "#24143d", end: "#080815" },
  { name: "Tide", start: "#07304a", end: "#07131e" },
];

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
  const [characterName, setCharacterName] = useState("Sanhua");
  const [accent, setAccent] = useState("#8b5cf6");
  const [particles, setParticles] = useState(true);
  const [rarity, setRarity] = useState(true);
  const [size, setSize] = useState("16:9");
  const [font, setFont] = useState("Inter");
  const [activeTool, setActiveTool] = useState("Template");
  const [backgroundIndex, setBackgroundIndex] = useState(0);
  const [effects, setEffects] = useState(true);
  const [frame, setFrame] = useState(true);
  const [decorations, setDecorations] = useState(true);
  const [compactTemplate, setCompactTemplate] = useState(false);
  const [saved, setSaved] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [notice, setNotice] = useState("");
  const timerRef = useRef(null);
  const previewButtonRef = useRef(null);
  const previewModalRef = useRef(null);
  const wasPreviewingRef = useRef(false);
  const nameInputRef = useRef(null);
  const canvasClassName = [
    "build-canvas",
    particles ? "particles-on" : "",
    effects ? "effects-on" : "effects-off",
    frame ? "frame-on" : "frame-off",
    decorations ? "decorations-on" : "decorations-off",
    compactTemplate ? "template-compact" : "template-classic",
    `background-${backgroundIndex}`,
  ]
    .filter(Boolean)
    .join(" ");

  const flash = (message) => {
    window.clearTimeout(timerRef.current);
    setNotice(message);
    timerRef.current = window.setTimeout(() => setNotice(""), 1800);
  };

  const save = () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        characterName,
        accent,
        particles,
        rarity,
        size,
        font,
        activeTool,
        backgroundIndex,
        effects,
        frame,
        decorations,
        compactTemplate,
      }),
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
    const actions = {
      Template: () => {
        setCompactTemplate((current) => !current);
        flash(`Switched to ${compactTemplate ? "classic" : "compact"} template`);
      },
      Background: () => {
        const nextIndex = (backgroundIndex + 1) % backgrounds.length;
        setBackgroundIndex(nextIndex);
        flash(`${backgrounds[nextIndex].name} background applied`);
      },
      Particles: () => {
        setParticles((current) => !current);
        flash(`Particles ${particles ? "hidden" : "shown"}`);
      },
      Effects: () => {
        setEffects((current) => !current);
        flash(`Glow effects ${effects ? "disabled" : "enabled"}`);
      },
      Text: () => {
        nameInputRef.current?.focus();
        flash("Character name ready to edit");
      },
      Frame: () => {
        setFrame((current) => !current);
        flash(`Frame ${frame ? "hidden" : "shown"}`);
      },
      Decorations: () => {
        setDecorations((current) => !current);
        flash(`Set bonus ${decorations ? "hidden" : "shown"}`);
      },
    };
    actions[item]?.();
  };

  const exportImage = () => {
    const [width, height] = exportSizes[size];
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      flash("Image export is not supported in this browser");
      return;
    }
    const background = backgrounds[backgroundIndex];
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, background.start);
    gradient.addColorStop(1, background.end);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    if (particles) {
      context.fillStyle = "rgba(255,255,255,0.65)";
      for (let index = 0; index < 70; index += 1) {
        const x = (index * 137) % width;
        const y = (index * 83) % height;
        context.fillRect(x, y, 2, 2);
      }
    }

    if (effects) {
      const glow = context.createRadialGradient(
        width * 0.64,
        height * 0.4,
        0,
        width * 0.64,
        height * 0.4,
        width * 0.38,
      );
      glow.addColorStop(0, `${accent}88`);
      glow.addColorStop(1, "transparent");
      context.fillStyle = glow;
      context.fillRect(0, 0, width, height);
    }

    if (frame) {
      context.strokeStyle = accent;
      context.lineWidth = 6;
      context.strokeRect(28, 28, width - 56, height - 56);
    }

    const scale = width / 1600;
    context.fillStyle = "#f8fbff";
    context.font = `700 ${64 * scale}px Inter, sans-serif`;
    context.fillText(characterName || "Untitled Build", 90 * scale, 130 * scale);
    context.fillStyle = "#b8c7db";
    context.font = `600 ${24 * scale}px Inter, sans-serif`;
    context.fillText("Lv. 90 / 90", 92 * scale, 175 * scale);
    if (rarity) {
      context.fillStyle = "#ffd45f";
      context.font = `${30 * scale}px sans-serif`;
      context.fillText("★★★★★", 90 * scale, 220 * scale);
    }

    context.fillStyle = "rgba(8,21,38,0.9)";
    context.fillRect(90 * scale, 290 * scale, 410 * scale, 420 * scale);
    context.fillStyle = "#eef5ff";
    context.font = `600 ${24 * scale}px Inter, sans-serif`;
    [
      ["HP", "15420"],
      ["ATK", "2456"],
      ["DEF", "1357"],
      ["Crit. Rate", "72.4%"],
      ["Crit. DMG", "248.6%"],
    ].forEach(([label, value], index) => {
      const y = (345 + index * 70) * scale;
      context.fillText(label, 125 * scale, y);
      context.textAlign = "right";
      context.fillText(value, 465 * scale, y);
      context.textAlign = "left";
    });

    context.fillStyle = `${accent}44`;
    context.beginPath();
    context.arc(width * 0.64, height * 0.48, Math.min(width, height) * 0.22, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#d8deeb";
    context.textAlign = "center";
    context.font = `${Math.min(width, height) * 0.22}px sans-serif`;
    context.fillText("❄", width * 0.64, height * 0.57);
    context.textAlign = "left";

    if (decorations) {
      context.fillStyle = "rgba(12,20,38,0.94)";
      context.fillRect(width * 0.42, height * 0.76, width * 0.46, height * 0.14);
      context.fillStyle = "#ffffff";
      context.font = `700 ${26 * scale}px Inter, sans-serif`;
      context.fillText("Frost Seeker", width * 0.45, height * 0.815);
      context.fillStyle = "#c6d4e8";
      context.font = `500 ${20 * scale}px Inter, sans-serif`;
      context.fillText("Glacio DMG +10% · Crit Rate 72.4%", width * 0.45, height * 0.86);
    }

    canvas.toBlob((blob) => {
      if (!blob) {
        flash("Image export failed");
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(characterName || "gachahub-build").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${size.replace(":", "x")}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      flash("PNG exported");
    }, "image/png");
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
        if (typeof settings.characterName === "string") setCharacterName(settings.characterName);
        if (Number.isInteger(settings.backgroundIndex))
          setBackgroundIndex(settings.backgroundIndex);
        if (typeof settings.effects === "boolean") setEffects(settings.effects);
        if (typeof settings.frame === "boolean") setFrame(settings.frame);
        if (typeof settings.decorations === "boolean") setDecorations(settings.decorations);
        if (typeof settings.compactTemplate === "boolean")
          setCompactTemplate(settings.compactTemplate);
        const selectedCharacter = new URLSearchParams(window.location.search).get("character");
        if (selectedCharacter) setCharacterName(selectedCharacter);
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
        <small>{characterName || "Untitled Build"}</small>
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
        <button className="export" onClick={exportImage} type="button">
          Export PNG
        </button>
      </aside>
      <main className="canvas-wrap">
        <div
          className={canvasClassName}
          style={{
            "--accent": accent,
            "--canvas-aspect-ratio": canvasSizes[size],
            "--canvas-font": canvasFonts[font],
          }}
        >
          <div className="canvas-header">
            <div className="char-badge">{glyph.sparkle}</div>
            <div>
              <h1>{characterName || "Untitled Build"}</h1>
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
          {decorations && (
            <div className="set-bonus">
              <b>{glyph.snow} Frost Seeker</b>
              <p>(2-Piece) Glacio DMG +10%</p>
              <p>(5-Piece) Using Basic Attack increases Glacio DMG.</p>
            </div>
          )}
        </div>
      </main>
      <aside className="canvas-settings">
        <div className="panel-head">
          <b>Canvas Settings</b>
          <span>Live</span>
        </div>
        <label htmlFor="character-name">Character</label>
        <input
          id="character-name"
          onChange={(event) => setCharacterName(event.target.value)}
          ref={nameInputRef}
          type="text"
          value={characterName}
        />
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
        <Toggle label="Glow Effects" value={effects} setValue={setEffects} />
        <Toggle label="Show Frame" value={frame} setValue={setFrame} />
        <Toggle label="Show Set Bonus" value={decorations} setValue={setDecorations} />
        <button
          className="reset"
          onClick={() => {
            setAccent("#8b5cf6");
            setParticles(true);
            setRarity(true);
            setSize("16:9");
            setFont("Inter");
            setCharacterName("Sanhua");
            setBackgroundIndex(0);
            setEffects(true);
            setFrame(true);
            setDecorations(true);
            setCompactTemplate(false);
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
              <b>{characterName || "Untitled"} build card</b>
              <small>
                {size} canvas · {font} type
              </small>
            </div>
            <div className="studio-preview-frame">
              <div
                className={canvasClassName}
                style={{
                  "--accent": accent,
                  "--canvas-aspect-ratio": canvasSizes[size],
                  "--canvas-font": canvasFonts[font],
                }}
              >
                <div className="canvas-header">
                  <div className="char-badge">{glyph.sparkle}</div>
                  <div>
                    <h1>{characterName || "Untitled Build"}</h1>
                    <p>Lv. 90 / 90</p>
                    {rarity && <div className="stars">{glyph.star.repeat(5)}</div>}
                  </div>
                </div>
                <Art tone="violet" className="canvas-character">
                  {glyph.snow}
                </Art>
                {decorations && (
                  <div className="set-bonus">
                    <b>{glyph.snow} Frost Seeker</b>
                    <p>Glacio DMG +10% · Crit Rate 72.4%</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
