import { glyph } from "./constants";
import type { ReactNode } from "react";

export function Art({
  tone = "violet",
  children,
  className = "",
}: {
  tone?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`art art-${tone} ${className}`}>
      <div className="moon" />
      <div className="silhouette">{children || glyph.sparkle}</div>
      <div className="art-lines" />
    </div>
  );
}
