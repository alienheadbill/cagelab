import React from "react";
import { lerpColor } from "../lib/utils.js";

// ---------- Decorative build-board silhouette (abstract, no real photos) ----------
// Fills in color and opacity as more attributes get locked in, so the board
// visibly "comes alive" as the draft progresses instead of sitting static.
// Fill reflects overall DRAFT COMPLETION only (drafted slots / total slots)
// -- deliberately not mapped to individual attributes (no "Chin = head"
// claims), since the app has no such body-region model to be truthful to.
// Direction correction: the fill target is CageLab gold, not a drift toward
// red -- red stays reserved for danger/loss, never "more built." Outline-only
// at 0 reads as a dark graphite silhouette (unbuilt), full brass at 1 (built).
function FighterSilhouette({ size = 96, fillPct = 0 }) {
  const color = lerpColor([90, 88, 82], [209, 166, 56], fillPct);
  const opacity = 0.4 + fillPct * 0.6;
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
