import React, { useState } from "react";
import { Sparkles } from "lucide-react";
import { SKILL_KEYS, ATTR_BY_KEY } from "../data/attrs.js";
import { sfx } from "../lib/audio.js";

function CampPlanningPanel({ onConfirm, currentStats, year, isFinalYear }) {
  const [focusAttr, setFocusAttr] = useState(null);
  const [campQuality, setCampQuality] = useState("full");
  const [stance, setStance] = useState("balanced");

  const overall = Math.round(SKILL_KEYS.reduce((s, k) => s + currentStats[k], 0) / SKILL_KEYS.length);
  let strongest = { key: SKILL_KEYS[0], val: -1 }, weakest = { key: SKILL_KEYS[0], val: 999 };
  SKILL_KEYS.forEach((k) => {
    const v = currentStats[k];
    if (v > strongest.val) strongest = { key: k, val: v };
    if (v < weakest.val) weakest = { key: k, val: v };
  });

  return (
    <div className="decision-panel">
      <div className="decision-title"><Sparkles size={15} /> {isFinalYear ? "Final Camp — One Last Run" : `Year ${year} Camp Planning`}</div>
      <div className="decision-sub">
        {isFinalYear
          ? "The last training camp of the career. However this year goes, it's the last chapter."
          : "Your current attributes, after aging and wear. Focus gives +4 for the whole year."}
      </div>

      <div className="camp-snapshot mono">
        <span>Overall <b>{overall}</b></span>
        <span className="good-text">Best: {ATTR_BY_KEY[strongest.key].label} <b>{Math.round(strongest.val)}</b></span>
        <span className="bad-text">Worst: {ATTR_BY_KEY[weakest.key].label} <b>{Math.round(weakest.val)}</b></span>
      </div>

      <div className="camp-stat-grid">
        {SKILL_KEYS.map((k) => {
          const a = ATTR_BY_KEY[k];
          const Icon = a.icon;
          const val = Math.round(currentStats[k]);
          return (
            <div
              key={k}
              className={`camp-stat ${focusAttr === k ? "focused" : ""}`}
              onClick={() => { sfx("select"); setFocusAttr(focusAttr === k ? null : k); }}
              role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFocusAttr(focusAttr === k ? null : k); } }}
            >
              <Icon size={14} />
              <span className="camp-stat-label">{a.label}</span>
              <span className="camp-stat-val mono">{val}</span>
              {focusAttr === k && <span className="camp-boost">+4</span>}
            </div>
          );
        })}
      </div>

      <div className="decision-group-label">Camp Length</div>
      <div className="choice-row">
        <button className={`choice-btn ${campQuality === "full" ? "active" : ""}`} onClick={() => { sfx("select"); setCampQuality("full"); }}>
          Full Camp<span>Fewer fights, safer</span>
        </button>
        <button className={`choice-btn ${campQuality === "short" ? "active" : ""}`} onClick={() => { sfx("select"); setCampQuality("short"); }}>
          Short Notice<span>More fights, riskier</span>
        </button>
      </div>

      <div className="decision-group-label">Gameplan</div>
      <div className="choice-row three">
        <button className={`choice-btn ${stance === "standup" ? "active" : ""}`} onClick={() => { sfx("select"); setStance("standup"); }}>Stand-Up</button>
        <button className={`choice-btn ${stance === "balanced" ? "active" : ""}`} onClick={() => { sfx("select"); setStance("balanced"); }}>Balanced</button>
        <button className={`choice-btn ${stance === "ground" ? "active" : ""}`} onClick={() => { sfx("select"); setStance("ground"); }}>Ground</button>
      </div>

      {focusAttr ? (
        <div className="camp-tradeoff mono">
          Focusing <b>{ATTR_BY_KEY[focusAttr].label}</b> (+4) means less mat time elsewhere — your two
          weakest other attributes each take -1 this year.
        </div>
      ) : (
        <div className="camp-tradeoff mono neutral">
          No focus selected — a balanced camp. No boost, but nothing declines either.
        </div>
      )}

      <button className="btn btn-dark" style={{ marginTop: 14 }} onClick={() => onConfirm({ focusAttr, campQuality, stance })}>
        {focusAttr ? `Begin Camp — Focus ${ATTR_BY_KEY[focusAttr].label}` : "Begin Camp — No Focus"}
      </button>
    </div>
  );
}

export default CampPlanningPanel;
