// =========================================================================
//  THE LAB -- working-copy construction helpers
//  Pure glue only. Every actual analysis (GOAT Score, Build Value,
//  archetype, synergies, matchup) stays in scoring.js/career.js -- this
//  file only builds and edits the `picks`-shaped object those functions
//  already expect, so The Lab is never a second source of truth for
//  anything they compute.
// =========================================================================
import { ATTRS, SKILL_KEYS, CLASS_PHYSICALS } from "../data/attrs.js";
import { relativeHeightScore, relativeReachScore } from "./scoring.js";

const DEFAULT_LAB_DIVISION = "Lightweight";
// 75 -- the same "solid division regular" baseline Build Value's own
// reference fighter uses (see BUILD_VALUE_REFERENCE in scoring.js) --
// a hypothetical fighter starts as a plausible pro, not a blank 0.
const DEFAULT_SKILL_VALUE = 75;

// A brand-new, fully custom fighter -- every skill at the same baseline,
// height/reach at the division's own midpoint (so it starts perfectly
// average for its class, same convention CLASS_PHYSICALS already defines).
function hypotheticalFighter(division = DEFAULT_LAB_DIVISION) {
  const physicals = CLASS_PHYSICALS[division] || CLASS_PHYSICALS[DEFAULT_LAB_DIVISION];
  const picks = {};
  SKILL_KEYS.forEach((k) => {
    picks[k] = { scoreValue: DEFAULT_SKILL_VALUE, display: String(DEFAULT_SKILL_VALUE), fighter: "Custom" };
  });
  picks.HEIGHT = { raw: physicals.ht, scoreValue: relativeHeightScore(physicals.ht, division), fighter: "Custom" };
  picks.REACH = { raw: physicals.rc, scoreValue: relativeReachScore(physicals.rc, division), fighter: "Custom" };
  return picks;
}

// Reconstructs the keyed picks object a Saved Build or Legacy career
// snapshot stores as a flat array -- same conversion loadSavedBuild and
// LegacyCareerDetail already do, centralized here so The Lab (a third
// consumer of the same stored shape) isn't a fourth copy of it. Always
// builds fresh objects (never reuses the source array's own object
// references), so editing the result can never mutate the original
// saved build or Legacy entry still sitting in storage.
function picksFromSnapshotArray(picksArray) {
  const picks = {};
  (picksArray || []).forEach((p) => {
    picks[p.key] = { fighter: p.fighter, display: p.display, scoreValue: p.scoreValue, raw: p.raw };
  });
  return picks;
}

// Immutable update for one of the 8 ordinary 0-99 skill ratings.
function updateSkillAttr(picks, key, value) {
  return { ...picks, [key]: { ...picks[key], scoreValue: value, display: String(value), fighter: "Custom" } };
}

// Height/Reach are NOT ordinary skill sliders -- exactly like the Draft,
// the editable quantity is real inches, and scoreValue is always DERIVED
// relative to the fighter's division (a 6'3" Lightweight and a 6'3"
// Heavyweight are not the same rating). Editing the raw inches recomputes
// scoreValue through the exact same relativeHeightScore/relativeReachScore
// the Draft itself uses, so a Lab fighter analyzes identically to an
// equivalent drafted one.
function updateHeightOrReach(picks, key, rawInches, division) {
  const scoreValue = key === "HEIGHT" ? relativeHeightScore(rawInches, division) : relativeReachScore(rawInches, division);
  return { ...picks, [key]: { ...picks[key], raw: rawInches, scoreValue, display: String(rawInches), fighter: "Custom" } };
}

// Changing division doesn't change a fighter's real height/reach in
// inches -- it changes how those inches rate relative to the new class.
// Re-derives both from their existing raw inches against the new
// division's midpoint, same relative-scoring call the Draft uses.
function applyDivisionToPicks(picks, division) {
  const next = { ...picks };
  if (next.HEIGHT && next.HEIGHT.raw != null) {
    next.HEIGHT = { ...next.HEIGHT, scoreValue: relativeHeightScore(next.HEIGHT.raw, division) };
  }
  if (next.REACH && next.REACH.raw != null) {
    next.REACH = { ...next.REACH, scoreValue: relativeReachScore(next.REACH.raw, division) };
  }
  return next;
}

// Fills in HEIGHT/REACH raw inches from the division midpoint for a
// loaded fighter whose snapshot predates this data (backward
// compatibility, same fallback CLASS_PHYSICALS already uses elsewhere) --
// never fabricates a division, only ever a plausible physical default
// within whichever division is already known or assumed.
function ensurePhysicals(picks, division) {
  const physicals = CLASS_PHYSICALS[division] || CLASS_PHYSICALS[DEFAULT_LAB_DIVISION];
  const next = { ...picks };
  if (!next.HEIGHT || next.HEIGHT.raw == null) {
    next.HEIGHT = { ...(next.HEIGHT || {}), raw: physicals.ht, scoreValue: relativeHeightScore(physicals.ht, division), fighter: (next.HEIGHT && next.HEIGHT.fighter) || "Custom" };
  }
  if (!next.REACH || next.REACH.raw == null) {
    next.REACH = { ...(next.REACH || {}), raw: physicals.rc, scoreValue: relativeReachScore(physicals.rc, division), fighter: (next.REACH && next.REACH.fighter) || "Custom" };
  }
  return next;
}

// Sanity check used before handing a Lab fighter to any scoring.js/
// career.js function -- every one of them reads picks[ATTR.key].scoreValue
// for all 10 attributes.
function isCompletePicks(picks) {
  return !!picks && ATTRS.every((a) => picks[a.key] && typeof picks[a.key].scoreValue === "number");
}

export {
  DEFAULT_LAB_DIVISION,
  DEFAULT_SKILL_VALUE,
  applyDivisionToPicks,
  ensurePhysicals,
  hypotheticalFighter,
  isCompletePicks,
  picksFromSnapshotArray,
  updateHeightOrReach,
  updateSkillAttr,
};
