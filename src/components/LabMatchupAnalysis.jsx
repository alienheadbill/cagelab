import React from "react";
import { ATTR_BY_KEY } from "../data/attrs.js";
import { computeFightPreview, deriveTraits } from "../lib/career.js";
import { strengthsWeaknesses } from "../lib/scoring.js";
import { flatAttrsFromPicks } from "../lib/lab.js";

// Presentation-only bucketing of the winProb computeFightPreview already
// returns -- same boundaries and label vocabulary matchupProfileFor
// (scoring.js) already uses for its own Favorable/Slight Edge/Even/
// Dangerous/Nightmare read of a matchup, just applied to a real Fighter A
// vs Fighter B pair instead of a fighter vs a synthetic archetype
// opponent. Not a new probability model -- winProb itself is untouched.
function edgeLabel(winProb) {
  if (winProb >= 0.62) return "favorable";
  if (winProb >= 0.54) return "slightEdge";
  if (winProb <= 0.38) return "nightmare";
  if (winProb <= 0.46) return "dangerous";
  return "even";
}

// The same "clearly one phase or the other" read buildFightNarrative
// (career.js) already applies to phase.groundShare/standShare when
// describing a resolved fight's shape -- reused verbatim (same 0.62
// threshold) so a Lab preview never disagrees with how a real Career
// fight's own narrative would describe the identical phase split.
function phaseDescription(phase) {
  if (phase.groundShare > 0.62) return "Likely a ground-heavy fight";
  if (phase.standShare > 0.62) return "Likely a striking-heavy fight";
  return "Likely a mixed-range fight";
}

// "Who has the edge, and why?" -- built entirely from computeFightPreview
// (the exact pathway Career's own pre-fight screen uses for its odds and
// matchup line) and strengthsWeaknesses (the exact pathway already shown
// as Primary/Secondary Weapon on every Lab fighter panel). No formula
// here is new; this only lays two fighters' already-computed numbers out
// side by side and narrates them. Preview only -- resolveFight is never
// called from this component.
function LabMatchupAnalysis({ fighterA, fighterB }) {
  const attrsA = flatAttrsFromPicks(fighterA.picks);
  const attrsB = flatAttrsFromPicks(fighterB.picks);
  const traitsA = deriveTraits(attrsA);
  const traitsB = deriveTraits(attrsB);
  // Neutral stance (0) -- the same default LabSimulation uses, since The
  // Lab has no stance concept of its own to feed in.
  const { winProb, matchup, phase } = computeFightPreview(
    attrsA, fighterA.picks.REACH.scoreValue, attrsB, 0, traitsA, traitsB
  );

  const favorsA = winProb >= 0.5;
  const favorite = favorsA ? fighterA : fighterB;
  const underdog = favorsA ? fighterB : fighterA;
  const winPct = Math.round((favorsA ? winProb : 1 - winProb) * 100);

  const bucket = edgeLabel(winProb);
  const edgeText = bucket === "even" ? "EVEN MATCHUP"
    : (bucket === "favorable" || bucket === "nightmare") ? `CLEAR EDGE — ${favorite.name.toUpperCase()}`
    : `SLIGHT EDGE — ${favorite.name.toUpperCase()}`;

  const favoriteWeapons = strengthsWeaknesses(favorite.picks).strengths;
  const underdogWeapons = strengthsWeaknesses(underdog.picks).strengths;

  // yourStrength/oppStrength are always A's/B's own single best SKILL
  // attribute (Height/Reach excluded, same as this matchup's label
  // elsewhere in the app) -- used here just to name the underdog's own
  // best weapon for the Key Battle question, not to recompute an edge.
  const underdogTopSkillKey = favorsA ? matchup.oppStrength.key : matchup.yourStrength.key;
  const underdogTopSkillLabel = ATTR_BY_KEY[underdogTopSkillKey].label;

  const crossDivision = fighterA.division !== fighterB.division;

  return (
    <div className="panel lab-matchup">
      <div className="collection-block-title">Matchup Analysis</div>
      {crossDivision && (
        <div className="help-text lab-matchup-note">
          {fighterA.name} is {fighterA.division}, {fighterB.name} is {fighterB.division} — ratings-only comparison, not a real fight matchup.
        </div>
      )}

      <div className="lab-matchup-edge">
        <div className="lab-matchup-edge-label mono">{edgeText}</div>
        <div className="lab-matchup-winpct mono">{winPct}% projected win probability</div>
      </div>

      <div className="result-weapon-row lab-matchup-weapons">
        <div><span>Primary Edge — {favorite.name}</span><b>{favoriteWeapons[0].label} + {favoriteWeapons[1].label}</b></div>
        <div><span>Opponent Path — {underdog.name}</span><b>{underdogWeapons[0].label} + {underdogWeapons[1].label}</b></div>
      </div>

      <div className="lab-matchup-phase mono">{phaseDescription(phase)}</div>

      <div className="lab-matchup-battle">
        <div className="decision-group-label">Key Battle</div>
        <div>Can {underdog.name} consistently force {underdogTopSkillLabel.toLowerCase()} exchanges?</div>
      </div>
    </div>
  );
}

export default LabMatchupAnalysis;
