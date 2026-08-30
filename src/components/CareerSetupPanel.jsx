import React, { useState } from "react";
import { ArrowLeft, Trophy } from "lucide-react";
import { SKILL_KEYS, WEIGHT_CLASSES, CLASS_PHYSICALS } from "../data/attrs.js";
import { ARCHETYPES, bestFitArchetypeFlat, STYLE_DESCRIPTIONS } from "../lib/career.js";
import { archetypeFor } from "../lib/scoring.js";
import { generateOpponentNames } from "../data/fighters.js";
import { formatHeight, formatReach } from "../lib/utils.js";
import { sfx } from "../lib/audio.js";

// ---------- Career Setup: configure the career, not the build ----------
// The build is already scored and finished. Everything set here shapes the
// CAREER only -- actual height/reach are cosmetic and never touch GOAT Score,
// which was locked in at draft time.
function CareerSetupPanel({ savedBuilds, currentPicks, currentName, onLaunch, onBack }) {
  const [selectedId, setSelectedId] = useState(currentPicks ? "__current__" : (savedBuilds[0] && savedBuilds[0].id) || null);

  // Resolve whichever build is selected into a { picks, name, division } shape.
  const resolved = (() => {
    if (selectedId === "__current__" && currentPicks) {
      return { picks: currentPicks, name: currentName, division: currentPicks.HEIGHT ? null : null };
    }
    const b = savedBuilds.find((x) => x.id === selectedId);
    if (!b) return null;
    const picks = {};
    (b.picks || []).forEach((p) => { picks[p.key] = { fighter: p.fighter, display: p.display, scoreValue: p.scoreValue }; });
    return { picks, name: b.fighterName, goatScore: b.goatScore };
  })();

  const base = resolved ? (() => {
    const o = {};
    SKILL_KEYS.forEach((k) => { o[k] = (resolved.picks[k] && resolved.picks[k].scoreValue) || 75; });
    return o;
  })() : null;

  const [name, setName] = useState(currentName || "");
  const [division, setDivision] = useState(WEIGHT_CLASSES[3]);
  const [debutEra, setDebutEra] = useState("2020s");
  const [style, setStyle] = useState(null);
  const naturalFit = base ? bestFitArchetypeFlat(base) : null;

  // Career-only physicals, defaulted from the division's typical build.
  const classPhys = CLASS_PHYSICALS[division] || CLASS_PHYSICALS.Lightweight;
  const [heightIn, setHeightIn] = useState(Math.round(classPhys.ht));
  const [reachIn, setReachIn] = useState(Math.round(classPhys.rc));

  if (!resolved) {
    return (
      <div className="panel">
        <div className="section-head-row">
          <button className="icon-btn" onClick={onBack} aria-label="Back"><ArrowLeft size={16} /></button>
          <div className="attr-name">Start a Career</div>
        </div>
        <div className="empty-txt">No builds available. Draft a fighter first, then come back.</div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="section-head-row">
        <button className="icon-btn" onClick={onBack} aria-label="Back"><ArrowLeft size={16} /></button>
        <div className="attr-name">Start a Career</div>
      </div>
      <div className="decision-sub" style={{ marginBottom: 14 }}>
        Take a finished build and live its career, fight by fight — rankings, titles, injuries, legacy.
      </div>

      <div className="setup-block">
        <div className="setup-label">Your Build</div>
        <select className="setup-select mono" value={selectedId || ""} onChange={(e) => setSelectedId(e.target.value)}>
          {currentPicks && <option value="__current__">Just drafted — {currentName}</option>}
          {savedBuilds.map((b) => (
            <option key={b.id} value={b.id}>{b.fighterName} — {b.goatScore} GOAT</option>
          ))}
        </select>
        {base && <div className="setup-hint">Plays like a <b>{archetypeFor(resolved.picks)}</b></div>}
      </div>

      <div className="setup-block">
        <div className="setup-label">Fighter Name</div>
        <input className="setup-input" value={name} onChange={(e) => setName(e.target.value.toUpperCase())}
               maxLength={24} placeholder="NAME YOUR FIGHTER" />
      </div>

      <div className="setup-block">
        <div className="setup-label">Division</div>
        <select className="setup-select mono" value={division} onChange={(e) => {
          const wc = e.target.value;
          setDivision(wc);
          const cp = CLASS_PHYSICALS[wc];
          setHeightIn(Math.round(cp.ht));
          setReachIn(Math.round(cp.rc));
        }}>
          {WEIGHT_CLASSES.map((wc) => <option key={wc} value={wc}>{wc}</option>)}
        </select>
      </div>

      <div className="setup-block">
        <div className="setup-label">Height &mdash; {formatHeight(heightIn)}</div>
        <input type="range" min="60" max="82" value={heightIn} className="setup-range"
               onChange={(e) => setHeightIn(Number(e.target.value))} />
        <div className="setup-label" style={{ marginTop: 8 }}>Reach &mdash; {formatReach(reachIn)}</div>
        <input type="range" min="60" max="86" value={reachIn} className="setup-range"
               onChange={(e) => setReachIn(Number(e.target.value))} />
        <div className="setup-hint">
          Career-mode only — your build's Height and Reach <b>ratings</b> still count toward its GOAT Score.
          This just sets how big your fighter actually is.
        </div>
      </div>

      <div className="setup-block">
        <div className="setup-label">Debut Era</div>
        <div className="era-row">
          {["2000s", "2010s", "2020s"].map((e) => (
            <button key={e} className={`choice-btn ${debutEra === e ? "active" : ""}`} onClick={() => setDebutEra(e)}>{e}</button>
          ))}
        </div>
      </div>

      <div className="setup-block">
        <div className="setup-label">Fighting Style</div>
        <div className="style-option-list">
          {[...ARCHETYPES.filter((a) => a.name !== "Balanced"), { name: "Balanced" }].map((a) => (
            <button key={a.name} className={`style-option ${style === a.name ? "active" : ""}`} onClick={() => { sfx("select"); setStyle(a.name); }}>
              <div className="style-option-top">
                <span className="style-option-name">{a.name}</span>
                {a.name === naturalFit && <span className="style-fit-tag">NATURAL FIT</span>}
              </div>
              <div className="style-option-desc">{STYLE_DESCRIPTIONS[a.name]}</div>
            </button>
          ))}
        </div>
      </div>

      <button
        className="btn btn-primary"
        style={{ marginTop: 8 }}
        onClick={() => onLaunch({
          picks: resolved.picks,
          // A blank name here shouldn't fall back to a fixed placeholder
          // that then carries through the whole career -- generate a real
          // one from the same pool that names every NPC.
          name: (name || resolved.name || "").trim() || generateOpponentNames(1)[0],
          division, debutEra,
          careerStyle: style || "Balanced",
          actualHeight: heightIn, actualReach: reachIn,
        })}
      >
        <Trophy size={16} /> Begin Career
      </button>
    </div>
  );
}

export default CareerSetupPanel;
