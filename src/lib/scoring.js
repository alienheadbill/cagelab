import { ATTRS, SKILL_KEYS, ATTR_BY_KEY, CLASS_PHYSICALS } from "../data/attrs.js";
import { clamp } from "./utils.js";
import { ARCHETYPES, estimatePhaseControl, phaseWeightedOutput, computeWinProbability } from "./career.js";

function relativeHeightScore(htInches, weightClass) {
  const mid = (CLASS_PHYSICALS[weightClass] && CLASS_PHYSICALS[weightClass].ht) || 72;
  const delta = htInches - mid;
  return clamp(Math.round(75 + delta * 5), 50, 99);
}

function relativeReachScore(rcInches, weightClass) {
  const mid = (CLASS_PHYSICALS[weightClass] && CLASS_PHYSICALS[weightClass].rc) || 73;
  const delta = rcInches - mid;
  return clamp(Math.round(75 + delta * 4.5), 50, 99);
}

function relativeNoteFor(kind, scoreValue) {
  if (kind === "height") {
    if (scoreValue >= 90) return "Huge for class";
    if (scoreValue >= 80) return "Long";
    if (scoreValue <= 60) return "Short for class";
    return null;
  }
  if (scoreValue >= 90) return "Massive reach";
  if (scoreValue >= 80) return "Long arms";
  if (scoreValue <= 60) return "Short arms";
  return null;
}

function tierOf(r) {
  if (r >= 90) return { label: "LEGENDARY", cls: "tier-legend" };
  if (r >= 80) return { label: "GOLD", cls: "tier-gold" };
  if (r >= 70) return { label: "SILVER", cls: "tier-silver" };
  return { label: "BRONZE", cls: "tier-bronze" };
}

// Retuned so a near-perfect build is rare: elite bonus only kicks in at 96+,
// weak-stat penalties are harsher, and the balance-bonus window is tighter.
// Same formula as before, just factored so the UI can show the real
// component breakdown (base/elite/balance/weak) instead of only the final
// number. computeGoatScore() below is unchanged in behavior.
function computeGoatScoreBreakdown(picks) {
  const values = ATTRS.map((a) => picks[a.key].scoreValue);
  const avg = values.reduce((s, r) => s + r, 0) / values.length;
  const base = Math.round(((avg - 50) / 49) * 100);
  const elite = values.filter((r) => r >= 96).length * 2 + values.filter((r) => r >= 90 && r < 96).length * 1;
  const weak = values.filter((r) => r < 55).length * 5 + values.filter((r) => r >= 55 && r < 65).length * 2;
  const spread = Math.max(...values) - Math.min(...values);
  const balance = spread <= 12 ? 5 : spread <= 22 ? 2 : 0;
  const final = Math.max(0, Math.min(100, base + elite + balance - weak));
  return { base, elite, balance, weak, spread, final };
}

function computeGoatScore(picks) {
  return computeGoatScoreBreakdown(picks).final;
}

// =========================================================================
//  BUILD VALUE: functional threat, not overall quality
//  A separate axis from GOAT Score, answering a different question. GOAT
//  Score asks "how complete is this fighter" (balanced attributes, few
//  weaknesses). Build Value asks "how dangerous is this fighter's actual
//  game" -- derived straight from the same combat model that drives real
//  fights (phaseWeightedOutput, already used by computeWinProbability and
//  the round-by-round sim), never a separate stat formula and never a
//  hardcoded "X+Y = bonus" combo table.
//
//  The idea: measure the build's own offensive output against a flat,
//  unspecialized "solid division regular" reference, scanned across a
//  spread of phase splits from grappling-heavy to striking-heavy. The
//  PEAK ratio -- how dominant this build is in whichever phase most favors
//  it -- is the headline signal. The FLOOR ratio -- how it fares in its
//  worst environment -- pulls a little back off that peak, so a real
//  weakness costs something, but a genuine, earned spike still beats an
//  unremarkable, safe floor.
//
//  Deliberately does NOT touch CARDIO/CHIN/SPEED/IQ -- those already
//  matter plenty (durability, fatigue, tactical edge) in
//  computeWinProbability and the round-by-round sim itself. Build Value
//  isolates pure offensive danger, a real, narrower question a tough
//  grinder can legitimately score low on without being a bad or
//  unplayable build (validated: a 96 Cardio/97 Chin build that scores 0
//  here still wins ~67% against a same-offense, average-durability
//  opponent in the actual fight engine -- 0 means "not a finisher," not
//  "bad fighter").
//
//  Analytical/scoring layer only -- nothing here feeds back into
//  resolveFight, computeWinProbability, or any other part of the fight
//  engine. It reads the combat model; it never changes what the combat
//  model does.
const BUILD_VALUE_REFERENCE = { STRIKING: 78, GRAPPLING: 78, WRESTLING: 78, CARDIO: 78, POWER: 78, CHIN: 78, SPEED: 78, IQ: 78 };
const BUILD_VALUE_PHASE_SPLITS = [0.15, 0.3, 0.5, 0.7, 0.85].map((standShare) => ({ standShare, groundShare: 1 - standShare }));
const BUILD_VALUE_DISCOUNT = 0.15;

function buildValueScale(ratio) {
  return clamp(Math.round(50 + (ratio - 1) * 200), 0, 100);
}

function computeBuildValueBreakdown(picks) {
  const player = {};
  SKILL_KEYS.forEach((k) => { player[k] = picks[k].scoreValue; });
  const ratios = BUILD_VALUE_PHASE_SPLITS.map((phase) => phaseWeightedOutput(player, phase) / phaseWeightedOutput(BUILD_VALUE_REFERENCE, phase));
  const peakRatio = Math.max(...ratios);
  const floorRatio = Math.min(...ratios);
  const peakScore = buildValueScale(peakRatio);
  const floorScore = buildValueScale(floorRatio);
  const discount = Math.round(BUILD_VALUE_DISCOUNT * (peakScore - floorScore));
  const buildValue = clamp(peakScore - discount, 0, 100);
  return { peakRatio, floorRatio, peakScore, floorScore, discount, buildValue };
}

function computeBuildValue(picks) {
  return computeBuildValueBreakdown(picks).buildValue;
}

// =========================================================================
//  SHAREABLE SCORECARD (text + downloadable PNG card)
// =========================================================================
// =========================================================================
//  BUILD ANALYSIS: archetype, strengths/weaknesses, synergies
//  All derived directly from the drafted scoreValues -- no hidden randomness.
// =========================================================================
const ARCHETYPE_COMBOS = [
  { keys: ["POWER", "STRIKING"], label: "Knockout Artist" },
  { keys: ["GRAPPLING", "WRESTLING"], label: "Ground Specialist" },
  { keys: ["CARDIO", "IQ"], label: "Tactician" },
  { keys: ["CHIN", "CARDIO"], label: "Iron Will" },
  { keys: ["SPEED", "STRIKING"], label: "Sharpshooter" },
  { keys: ["WRESTLING", "CHIN"], label: "Grinder" },
];

function archetypeFor(picks) {
  const v = (k) => picks[k].scoreValue;
  let best = { label: "All-Rounder", score: -1 };
  ARCHETYPE_COMBOS.forEach((c) => {
    const score = c.keys.reduce((s, k) => s + v(k), 0);
    if (score > best.score) best = { label: c.label, score };
  });
  return best.label;
}

const SYNERGY_DEFS = [
  { keys: ["POWER", "STRIKING"], min: 85, label: "Knockout Power", desc: "Power and Striking both elite -- a real finishing threat." },
  { keys: ["GRAPPLING", "WRESTLING"], min: 82, label: "Ground Control", desc: "Can take the fight anywhere and control it once it's there." },
  { keys: ["CARDIO", "IQ"], min: 82, label: "Championship Rounds", desc: "Built to win close decisions in the late rounds." },
  { keys: ["CHIN", "CARDIO"], min: 82, label: "Iron Will", desc: "Extremely hard to finish or fatigue." },
  { keys: ["SPEED", "CARDIO"], min: 82, label: "Athletic Freak", desc: "Elite gas tank paired with elite speed." },
];

function synergiesFor(picks) {
  const v = (k) => picks[k].scoreValue;
  return SYNERGY_DEFS.filter((s) => s.keys.every((k) => v(k) >= s.min));
}

function strengthsWeaknesses(picks) {
  const rows = ATTRS.map((a) => ({ key: a.key, label: a.label, value: picks[a.key].scoreValue }));
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  return { strengths: sorted.slice(0, 3), weaknesses: sorted.slice(-3).reverse() };
}

// Rough live estimate of where the GOAT Score is heading based on picks so
// far -- same base curve as the real formula, but without the elite/balance
// bonuses that only make sense once all 10 attributes are locked in.
function estimateGoatSoFar(picks) {
  const values = Object.values(picks).map((p) => p.scoreValue);
  if (values.length === 0) return null;
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  return clamp(Math.round(((avg - 50) / 49) * 100), 0, 100);
}

function buildScorecardText({ name, goatScore, picks, career }) {
  const lines = [`CAGELAB • ${goatScore} GOAT`];
  ATTRS.forEach((a) => {
    const p = picks[a.key];
    lines.push(`${a.label}: ${p.fighter} (${p.display})`);
  });
  if (career) {
    lines.push("");
    lines.push(`Career: ${career.record.w}-${career.record.l} • ${career.titleReigns}× Champ • ${career.verdict}`);
  }
  return lines.join("\n");
}

// ---- Build-level matchup analysis (Result screen) --------------------------
// Builds a canonical "elite example" of each career archetype at a fixed
// rating (no jitter), then runs the SAME phase-control + win-probability math
// used for real career fights. The win% and the label both come straight out
// of that -- nothing here is scripted per archetype.
function buildArchetypeOpponent(archetype, baseRating) {
  const attrs = {};
  SKILL_KEYS.forEach((k) => {
    const mult = archetype.mult[k] || 1;
    attrs[k] = clamp(Math.round(baseRating * mult), 40, 99);
  });
  return attrs;
}

// Re-derives the same gap terms computeWinProbability uses internally, purely
// so the UI can narrate *why* a matchup swings the way it does. Kept as a
// separate function (rather than changing computeWinProbability's return
// shape) so the real engine used by Career Mode is untouched.
function matchupFactors(player, opp, phase, reachScore) {
  return [
    { label: "output", val: (phaseWeightedOutput(player, phase) - phaseWeightedOutput(opp, phase)) / 220 },
    { label: "durability", val: ((player.CHIN + player.CARDIO * 0.5) - (opp.CHIN + opp.CARDIO * 0.5)) / 300 },
    { label: "fight IQ", val: (player.IQ - opp.IQ) / 400 },
    { label: "speed", val: (player.SPEED - opp.SPEED) / 500 },
  ];
}

function matchupProfileFor(picks) {
  const player = {};
  SKILL_KEYS.forEach((k) => { player[k] = picks[k].scoreValue; });
  const reachScore = picks.REACH.scoreValue;

  return ARCHETYPES.filter((a) => a.name !== "Balanced").map((archetype) => {
    const opp = buildArchetypeOpponent(archetype, 85); // 85 = a credible elite-level example of the style
    const phase = estimatePhaseControl(player, opp, 0);
    const winProb = computeWinProbability(player, opp, phase, reachScore);
    const label =
      winProb >= 0.62 ? "Favorable" :
      winProb >= 0.54 ? "Slight Edge" :
      winProb <= 0.38 ? "Nightmare" :
      winProb <= 0.46 ? "Dangerous" : "Even";

    const factors = [...matchupFactors(player, opp, phase, reachScore)].sort((a, b) => Math.abs(b.val) - Math.abs(a.val));
    const best = factors[0], worst = factors[factors.length - 1];
    let explanation;
    if (best.val > 0 && worst.val < 0 && best.label !== worst.label) {
      explanation = `Your ${best.label} edge helps here, but ${worst.label} is a real gap against this style.`;
    } else if (best.val > 0) {
      explanation = `Your ${best.label} carries this matchup.`;
    } else {
      explanation = `This style exposes your ${worst.label}.`;
    }
    return { name: archetype.name, winPct: Math.round(winProb * 100), label, explanation };
  });
}

export {
  archetypeFor,
  buildScorecardText,
  computeBuildValue,
  computeBuildValueBreakdown,
  computeGoatScore,
  computeGoatScoreBreakdown,
  estimateGoatSoFar,
  matchupProfileFor,
  relativeHeightScore,
  relativeNoteFor,
  relativeReachScore,
  strengthsWeaknesses,
  synergiesFor,
  tierOf,
};
