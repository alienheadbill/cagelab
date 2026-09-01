import React from "react";
import { Sparkles, X } from "lucide-react";
import { ATTR_BY_KEY, SKILL_KEYS, WEIGHT_CLASSES } from "../data/attrs.js";
import { formatHeight, formatReach } from "../lib/utils.js";
import {
  computeGoatScoreBreakdown, computeBuildValueBreakdown, archetypeFor, strengthsWeaknesses, synergiesFor,
} from "../lib/scoring.js";
import { updateSkillAttr, updateHeightOrReach, applyDivisionToPicks } from "../lib/lab.js";
import RadarChart from "./RadarChart.jsx";

// One fighter's editable workbench: sliders on the left/below, live
// analysis on the right/above -- everything here is either a controlled
// input or a straight read of scoring.js's own functions. No score, no
// archetype, no synergy is computed in this file.
function LabFighterPanel({ fighter, onChange, onClear }) {
  const { name, division, picks } = fighter;
  const breakdown = computeGoatScoreBreakdown(picks);
  const buildValue = computeBuildValueBreakdown(picks).buildValue;
  const archetype = archetypeFor(picks);
  const { strengths, weaknesses } = strengthsWeaknesses(picks);
  const synergies = synergiesFor(picks);

  function setSkill(key, value) {
    onChange({ ...fighter, picks: updateSkillAttr(picks, key, value) });
  }
  function setPhysical(key, inches) {
    onChange({ ...fighter, picks: updateHeightOrReach(picks, key, inches, division) });
  }
  function setDivision(nextDivision) {
    onChange({ ...fighter, division: nextDivision, picks: applyDivisionToPicks(picks, nextDivision) });
  }

  return (
    <div className="panel lab-fighter-panel">
      <div className="lab-panel-head">
        <input
          className="lab-name-input"
          value={name}
          onChange={(e) => onChange({ ...fighter, name: e.target.value.slice(0, 30) })}
          placeholder="FIGHTER NAME"
          aria-label="Fighter name"
        />
        <button className="icon-btn" onClick={onClear} aria-label="Clear this fighter"><X size={14} /></button>
      </div>

      <select
        className="lab-division-select mono"
        value={division}
        onChange={(e) => setDivision(e.target.value)}
        aria-label="Division"
      >
        {WEIGHT_CLASSES.map((wc) => <option key={wc} value={wc}>{wc}</option>)}
      </select>

      <div className="stat-grid lab-stat-grid">
        <div className="stat-box"><div className="stat-num">{breakdown.final}</div><div className="stat-lbl">GOAT Score</div></div>
        <div className="stat-box"><div className="stat-num">{buildValue}</div><div className="stat-lbl">Build Value</div></div>
      </div>
      <div className="lab-archetype display">THE {archetype.toUpperCase()}</div>

      <RadarChart picks={picks} size={200} />
      <div className="radar-legend">
        <span><span className="radar-swatch build" /> This Fighter</span>
        <span><span className="radar-swatch benchmark" /> Elite (85)</span>
      </div>

      <div className="decision-group-label">Attributes</div>
      <div className="lab-slider-list">
        {SKILL_KEYS.map((key) => (
          <div className="lab-slider-row" key={key}>
            <div className="lab-slider-top">
              <span className="lab-slider-label">{ATTR_BY_KEY[key].label}</span>
              <span className="lab-slider-value mono">{picks[key].scoreValue}</span>
            </div>
            <input
              type="range" min={40} max={99} value={picks[key].scoreValue}
              onChange={(e) => setSkill(key, Number(e.target.value))}
              className="lab-slider" aria-label={`${ATTR_BY_KEY[key].label} rating`}
            />
          </div>
        ))}
        {/* Height/Reach edit real inches, not a raw 0-99 score -- the
            displayed rating is always DERIVED (relativeHeightScore/
            relativeReachScore against the current division), the exact
            same relationship the Draft itself uses. */}
        <div className="lab-slider-row">
          <div className="lab-slider-top">
            <span className="lab-slider-label">Height</span>
            <span className="lab-slider-value mono">{formatHeight(picks.HEIGHT.raw)} <span className="lab-derived-score">({picks.HEIGHT.scoreValue})</span></span>
          </div>
          <input
            type="range" min={60} max={84} value={picks.HEIGHT.raw}
            onChange={(e) => setPhysical("HEIGHT", Number(e.target.value))}
            className="lab-slider" aria-label="Height in inches"
          />
        </div>
        <div className="lab-slider-row">
          <div className="lab-slider-top">
            <span className="lab-slider-label">Reach</span>
            <span className="lab-slider-value mono">{formatReach(picks.REACH.raw)} <span className="lab-derived-score">({picks.REACH.scoreValue})</span></span>
          </div>
          <input
            type="range" min={60} max={86} value={picks.REACH.raw}
            onChange={(e) => setPhysical("REACH", Number(e.target.value))}
            className="lab-slider" aria-label="Reach in inches"
          />
        </div>
      </div>

      <div className="result-weapon-row">
        <div><span>Primary Weapon</span><b>{strengths[0].label}</b></div>
        <div><span>Secondary Weapon</span><b>{strengths[1].label}</b></div>
        <div><span>Liability</span><b className="bad-text">{weaknesses[0].label}</b></div>
      </div>

      {synergies.length > 0 && (
        <div className="synergy-block">
          <div className="decision-group-label">Synergies</div>
          {synergies.map((s) => (
            <div className="synergy-chip" key={s.label}>
              <Sparkles size={12} /> <b>{s.label}</b> &mdash; {s.desc}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default LabFighterPanel;
