import React from "react";
import { ATTRS, ATTR_BY_KEY } from "../data/attrs.js";
import { clamp } from "../lib/utils.js";

// ---------- Attribute radar chart (dependency-free SVG) ----------
// Plots all 10 drafted attributes against a fixed "Elite (85)" benchmark ring
// so the shape of the build -- not just its average -- reads at a glance.
function RadarChart({ picks, size = 220 }) {
  const keys = ATTRS.map((a) => a.key);
  const n = keys.length;
  const cx = size / 2, cy = size / 2, r = size / 2 - 30;
  const angleFor = (i) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pointFor = (i, val) => {
    const frac = clamp((val - 50) / 49, 0, 1);
    const ang = angleFor(i);
    return [cx + r * frac * Math.cos(ang), cy + r * frac * Math.sin(ang)];
  };
  const toPoly = (vals) => vals.map((v, i) => pointFor(i, v).join(",")).join(" ");
  const buildValues = keys.map((k) => picks[k].scoreValue);
  const benchmarkValues = keys.map(() => 85);
  const rings = [0.25, 0.5, 0.75, 1].map((f) => toPoly(keys.map(() => 50 + f * 49)));

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ maxWidth: size, display: "block", margin: "0 auto" }} role="img" aria-label="Attribute radar chart, plotted against an elite benchmark">
      {rings.map((pts, i) => <polygon key={i} points={pts} className="radar-ring" />)}
      {keys.map((_, i) => {
        const [x, y] = pointFor(i, 99);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} className="radar-spoke" />;
      })}
      <polygon points={toPoly(benchmarkValues)} className="radar-benchmark" />
      <polygon points={toPoly(buildValues)} className="radar-build" />
      {keys.map((k, i) => {
        const ang = angleFor(i);
        const lx = cx + (r + 16) * Math.cos(ang);
        const ly = cy + (r + 16) * Math.sin(ang);
        return <text key={k} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="radar-label">{ATTR_BY_KEY[k].abbr}</text>;
      })}
    </svg>
  );
}

export default RadarChart;
