function formatHeight(inches) {
  const ft = Math.floor(inches / 12);
  const inch = Math.round(inches % 12);
  return `${ft}'${inch}"`;
}

function formatReach(inches) {
  return `${inches % 1 === 0 ? inches : inches.toFixed(1)}"`;
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function slugify(str) {
  return str.trim().toLowerCase().replace(/[()]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function lerpColor(c1, c2, t) {
  const r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
  const g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
  const b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

export {
  clamp,
  formatHeight,
  formatReach,
  lerpColor,
  slugify,
};
