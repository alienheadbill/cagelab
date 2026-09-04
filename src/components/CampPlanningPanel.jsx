import React, { useState } from "react";
import { Sparkles } from "lucide-react";
import { SKILL_KEYS, ATTR_BY_KEY } from "../data/attrs.js";
import { CAMP_FOCUSES, previewCampFocus } from "../lib/career.js";
import { sfx } from "../lib/audio.js";

const FOCUS_IDS = Object.keys(CAMP_FOCUSES);

// Training Camp Rework V1: five MMA-authentic Camp focuses replace the old
// raw 8-attribute picker (CHIN included). Every focus writes permanently to
// s.base now (see resolveCampPlanning) -- the preview below calls the EXACT
// same formula (previewCampFocus), so what's shown before "Begin Camp" is
// never a fake range.
function CampPlanningPanel({ onConfirm, currentStats, coach, year, isFinalYear }) {
  const [focus, setFocus] = useState(null);
  const [campQuality, setCampQuality] = useState("full");

  const overall = Math.round(SKILL_KEYS.reduce((s, k) => s + currentStats[k], 0) / SKILL_KEYS.length);
  let strongest = { key: SKILL_KEYS[0], val: -1 }, weakest = { key: SKILL_KEYS[0], val: 999 };
  SKILL_KEYS.forEach((k) => {
    const v = currentStats[k];
    if (v > strongest.val) strongest = { key: k, val: v };
    if (v < weakest.val) weakest = { key: k, val: v };
  });

  const preview = focus ? previewCampFocus(currentStats, year, coach, focus) : null;

  return (
    <div className="decision-panel">
      <div className="decision-title"><Sparkles size={15} /> {isFinalYear ? "Final Camp — One Last Run" : `Year ${year} Camp Planning`}</div>
      <div className="decision-sub">
        {isFinalYear
          ? "The last training camp of the career. However this year goes, it's the last chapter."
          : "Your current attributes, after aging and wear. Pick a focus to develop it for real."}
      </div>

      <div className="camp-snapshot mono">
        <span>Overall <b>{overall}</b></span>
        <span className="good-text">Best: {ATTR_BY_KEY[strongest.key].label} <b>{Math.round(strongest.val)}</b></span>
        <span className="bad-text">Worst: {ATTR_BY_KEY[weakest.key].label} <b>{Math.round(weakest.val)}</b></span>
      </div>

      <div className="decision-group-label">Camp Focus</div>
      <div className="camp-focus-grid">
        {FOCUS_IDS.map((id) => {
          const def = CAMP_FOCUSES[id];
          return (
            <div
              key={id}
              className={`camp-focus-card ${focus === id ? "focused" : ""}`}
              onClick={() => { sfx("select"); setFocus(focus === id ? null : id); }}
              role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFocus(focus === id ? null : id); } }}
            >
              <div className="camp-focus-label">{def.label}</div>
              <div className="camp-focus-detail mono">
                {ATTR_BY_KEY[def.primary].label} {Math.round(currentStats[def.primary])}
                {def.secondary ? ` + ${ATTR_BY_KEY[def.secondary].label} ${Math.round(currentStats[def.secondary])}` : def.recovery ? " + recovery" : ""}
              </div>
            </div>
          );
        })}
      </div>

      {preview ? (
        <div className="camp-preview mono">
          <div className="camp-preview-row">
            <span>{ATTR_BY_KEY[preview.primaryAttr].label}</span>
            <span className="good-text">Expected development: +{preview.primaryGain.toFixed(1)}</span>
          </div>
          {preview.secondaryAttr && (
            <div className="camp-preview-row">
              <span>{ATTR_BY_KEY[preview.secondaryAttr].label}</span>
              <span className="good-text">Expected development: +{preview.secondaryGain.toFixed(1)}</span>
            </div>
          )}
          {preview.recovery && (
            <div className="camp-preview-row"><span>Recovery</span><span className="good-text">Reduces accumulated wear</span></div>
          )}
          <div className="camp-preview-note">Development is slower at elite ratings.</div>
        </div>
      ) : (
        <div className="camp-tradeoff mono neutral">
          No focus selected — a balanced camp. No development, but nothing declines either.
        </div>
      )}

      <div className="decision-group-label">Camp Length</div>
      <div className="choice-row">
        <button className={`choice-btn ${campQuality === "full" ? "active" : ""}`} onClick={() => { sfx("select"); setCampQuality("full"); }}>
          Full Camp<span>Fewer fights this year, lower injury risk</span>
        </button>
        <button className={`choice-btn ${campQuality === "short" ? "active" : ""}`} onClick={() => { sfx("select"); setCampQuality("short"); }}>
          Short Notice<span>More fights this year, higher injury risk</span>
        </button>
      </div>

      <button className="btn btn-dark" style={{ marginTop: 14 }} onClick={() => onConfirm({ focus, campQuality })}>
        {focus ? `Begin Camp — ${CAMP_FOCUSES[focus].label}` : "Begin Camp — No Focus"}
      </button>
    </div>
  );
}

export default CampPlanningPanel;
