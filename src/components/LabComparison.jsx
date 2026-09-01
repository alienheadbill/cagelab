import React from "react";
import { ATTRS } from "../data/attrs.js";
import { formatHeight, formatReach } from "../lib/utils.js";
import { computeGoatScoreBreakdown, computeBuildValueBreakdown, archetypeFor, strengthsWeaknesses } from "../lib/scoring.js";
import RadarChart from "./RadarChart.jsx";

// One attribute row: both raw scoreValues, which side (if either) has the
// advantage, and the differential -- all read straight off each fighter's
// own picks object, nothing computed here beyond a plain subtraction.
function CompareRow({ label, aVal, bVal, aSub, bSub }) {
  const diff = aVal - bVal;
  const aWins = diff > 0, bWins = diff < 0;
  return (
    <div className="lab-compare-row">
      <div className={`lab-compare-val ${aWins ? "adv" : ""}`}>
        {aWins && <span className="attr-marker best-marker">▲</span>}
        <b>{aVal}</b>{aSub && <span className="lab-compare-sub">{aSub}</span>}
      </div>
      <div className="lab-compare-lbl">
        {label}
        {diff !== 0 && <span className="lab-compare-diff mono">{diff > 0 ? `+${diff}` : diff}</span>}
      </div>
      <div className={`lab-compare-val ${bWins ? "adv" : ""}`}>
        {bWins && <span className="attr-marker best-marker">▲</span>}
        <b>{bVal}</b>{bSub && <span className="lab-compare-sub">{bSub}</span>}
      </div>
    </div>
  );
}

// Everything here is a direct read of scoring.js's own functions, called
// twice (once per fighter) and laid side by side -- no comparison formula
// of its own exists anywhere in this file.
function LabComparison({ fighterA, fighterB }) {
  const aGoat = computeGoatScoreBreakdown(fighterA.picks).final;
  const bGoat = computeGoatScoreBreakdown(fighterB.picks).final;
  const aBv = computeBuildValueBreakdown(fighterA.picks).buildValue;
  const bBv = computeBuildValueBreakdown(fighterB.picks).buildValue;
  const aArchetype = archetypeFor(fighterA.picks);
  const bArchetype = archetypeFor(fighterB.picks);
  const aWeapon = strengthsWeaknesses(fighterA.picks).strengths[0].label;
  const bWeapon = strengthsWeaknesses(fighterB.picks).strengths[0].label;

  return (
    <div className="panel lab-comparison">
      <div className="collection-block-title">Compare</div>
      <div className="lab-compare-identity">
        <div className="lab-compare-name">{fighterA.name}</div>
        <span className="lab-compare-vs mono">VS</span>
        <div className="lab-compare-name">{fighterB.name}</div>
      </div>

      <CompareRow label="GOAT Score" aVal={aGoat} bVal={bGoat} />
      <CompareRow label="Build Value" aVal={aBv} bVal={bBv} />
      <div className="lab-compare-row lab-compare-text-row">
        <div className="lab-compare-text">{aArchetype}</div>
        <div className="lab-compare-lbl">Archetype</div>
        <div className="lab-compare-text">{bArchetype}</div>
      </div>
      <div className="lab-compare-row lab-compare-text-row">
        <div className="lab-compare-text">{aWeapon}</div>
        <div className="lab-compare-lbl">Primary Weapon</div>
        <div className="lab-compare-text">{bWeapon}</div>
      </div>

      <RadarChart picks={fighterA.picks} opponentPicks={fighterB.picks} size={220} />
      <div className="radar-legend">
        <span><span className="radar-swatch build" /> {fighterA.name}</span>
        <span><span className="radar-swatch opponent" /> {fighterB.name}</span>
      </div>

      <div className="decision-group-label">Attributes</div>
      {ATTRS.map((a) => {
        const aP = fighterA.picks[a.key], bP = fighterB.picks[a.key];
        // Height/Reach show real inches alongside the division-relative
        // rating -- same pair the Draft and LabFighterPanel both show,
        // since the raw number alone ("6'0\"") isn't comparable the way a
        // plain 0-99 skill rating is.
        const isPhysical = a.key === "HEIGHT" || a.key === "REACH";
        const aSub = isPhysical ? (a.key === "HEIGHT" ? formatHeight(aP.raw) : formatReach(aP.raw)) : null;
        const bSub = isPhysical ? (a.key === "HEIGHT" ? formatHeight(bP.raw) : formatReach(bP.raw)) : null;
        return <CompareRow key={a.key} label={a.label} aVal={aP.scoreValue} bVal={bP.scoreValue} aSub={aSub} bSub={bSub} />;
      })}
    </div>
  );
}

export default LabComparison;
