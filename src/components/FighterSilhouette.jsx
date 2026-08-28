import React from "react";
import { lerpColor } from "../lib/utils.js";

// ---------- Decorative build-board silhouette (abstract, no real photos) ----------
// Fills in color and opacity as more attributes get locked in, so the board
// visibly "comes alive" as the draft progresses instead of sitting static.
function FighterSilhouette({ size = 96, fillPct = 0 }) {
  const color = lerpColor([176, 141, 63], [140, 29, 24], fillPct);
  const opacity = 0.3 + fillPct * 0.65;
  return (
    <svg viewBox="0 0 120 160" width={size} height={Math.round(size * (160 / 120))} className="silhouette-svg" style={{ fill: color, opacity }} aria-hidden="true">
      <circle cx="60" cy="26" r="20" />
      <rect x="35" y="48" width="50" height="56" rx="14" />
      <rect x="9" y="54" width="18" height="56" rx="9" />
      <rect x="93" y="54" width="18" height="56" rx="9" />
      <rect x="37" y="106" width="19" height="50" rx="9" />
      <rect x="64" y="106" width="19" height="50" rx="9" />
    </svg>
  );
}

export default FighterSilhouette;
