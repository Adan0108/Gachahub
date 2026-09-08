import { glyph } from "./constants";

export function Art({ tone = "violet", children, className = "" }) {
  return (
    <div className={`art art-${tone} ${className}`}>
      <div className="moon" />
      <div className="silhouette">{children || glyph.sparkle}</div>
      <div className="art-lines" />
    </div>
  );
}
