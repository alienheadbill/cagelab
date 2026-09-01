import React, { useState } from "react";
import { ArrowLeft, FlaskConical, Save, Award, Wand2 } from "lucide-react";
import { hypotheticalFighter, picksFromSnapshotArray, ensurePhysicals, DEFAULT_LAB_DIVISION } from "../lib/lab.js";
import LabFighterPanel from "./LabFighterPanel.jsx";

// Builds a fresh, independent working fighter from a Saved Build or a
// Legacy career snapshot. picksFromSnapshotArray already builds new
// objects at every level (never reuses the source's own references), so
// editing the result can never reach back and mutate the saved build or
// Legacy entry still sitting in storage.
function fighterFromSaved(build) {
  const division = build.division || DEFAULT_LAB_DIVISION;
  return { name: build.fighterName || "Fighter", division, origin: "build", picks: ensurePhysicals(picksFromSnapshotArray(build.picks), division) };
}
function fighterFromLegacy(career) {
  const division = career.division || DEFAULT_LAB_DIVISION;
  return { name: career.fighterName || "Fighter", division, origin: "legacy", picks: ensurePhysicals(picksFromSnapshotArray(career.picks), division) };
}
function newHypothetical() {
  return { name: "New Fighter", division: DEFAULT_LAB_DIVISION, origin: "hypothetical", picks: hypotheticalFighter(DEFAULT_LAB_DIVISION) };
}

// Picks which fighter to load into a Lab slot -- three sources, all
// producing the same working-fighter shape. Nothing here is picked
// automatically; the player always chooses.
function SourcePicker({ savedBuilds, careerHistory, onPick }) {
  const [expanded, setExpanded] = useState(null); // null | "builds" | "legacy"

  if (expanded === "builds") {
    return (
      <div className="lab-source-list">
        <button className="text-btn lab-source-back" onClick={() => setExpanded(null)}>&larr; Back</button>
        {savedBuilds.length === 0 && <div className="empty-txt">No saved builds yet.</div>}
        {savedBuilds.map((b) => (
          <button className="collection-row lab-source-row" key={b.id} onClick={() => onPick(fighterFromSaved(b))}>
            <div>
              <div className="collection-row-title">{b.fighterName}</div>
              <div className="collection-row-sub mono">{b.mode} &middot; GOAT {b.goatScore}</div>
            </div>
          </button>
        ))}
      </div>
    );
  }
  if (expanded === "legacy") {
    return (
      <div className="lab-source-list">
        <button className="text-btn lab-source-back" onClick={() => setExpanded(null)}>&larr; Back</button>
        {careerHistory.length === 0 && <div className="empty-txt">No Legacy careers yet.</div>}
        {careerHistory.map((c) => (
          <button className="collection-row lab-source-row" key={c.id} onClick={() => onPick(fighterFromLegacy(c))}>
            <div>
              <div className="collection-row-title">{c.fighterName}</div>
              <div className="collection-row-sub mono">{c.record.w}-{c.record.l} &middot; {c.verdict}</div>
            </div>
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="lab-source-choices">
      <button className="choice-btn full" onClick={() => setExpanded("builds")}>
        <Save size={14} /> Load a Saved Build<span>Pick from your saved drafts</span>
      </button>
      <button className="choice-btn full" onClick={() => setExpanded("legacy")}>
        <Award size={14} /> Load a Legacy Fighter<span>Pull a fighter from a past career</span>
      </button>
      <button className="choice-btn full" onClick={() => onPick(newHypothetical())}>
        <Wand2 size={14} /> Create a Hypothetical Fighter<span>Start from a blank slate</span>
      </button>
    </div>
  );
}

// ---------- The Lab ----------
// A safe, isolated workbench: load a working COPY of a fighter, edit it
// freely, watch the same analysis the rest of CageLab already computes
// update live. Nothing here ever writes back to savedBuilds, careerHistory,
// or any Career state -- see fighterFromSaved/fighterFromLegacy above for
// why editing a loaded fighter can't reach the original.
function LabScreen({ onBack, savedBuilds, careerHistory }) {
  const [fighterA, setFighterA] = useState(null);

  return (
    <div className="panel">
      <div className="section-head-row">
        <button className="icon-btn" onClick={onBack} aria-label="Back"><ArrowLeft size={16} /></button>
        <div className="attr-name"><FlaskConical size={16} style={{ verticalAlign: -2, marginRight: 6 }} />The Lab</div>
      </div>
      <div className="help-text lab-intro">
        Experiment freely -- nothing here touches your saved builds, Career progress, or Legacy history. Load a fighter, change anything, see what happens.
      </div>

      {fighterA ? (
        <LabFighterPanel fighter={fighterA} onChange={setFighterA} onClear={() => setFighterA(null)} />
      ) : (
        <div className="lab-empty">
          <FlaskConical size={26} />
          <div className="lab-empty-title">Load a Fighter to Begin</div>
          <SourcePicker savedBuilds={savedBuilds} careerHistory={careerHistory} onPick={setFighterA} />
        </div>
      )}
    </div>
  );
}

export default LabScreen;
