import React, { useState } from "react";
import { ArrowLeft, Trophy, Ruler } from "lucide-react";
import { SKILL_KEYS, CLASS_PHYSICALS, ATTR_BY_KEY } from "../data/attrs.js";
import { ARCHETYPES, bestFitArchetypeFlat, STYLE_DESCRIPTIONS } from "../lib/career.js";
import { archetypeFor } from "../lib/scoring.js";
import { generateOpponentNames } from "../data/fighters.js";
import { formatHeight, formatReach } from "../lib/utils.js";
import { sfx } from "../lib/audio.js";

// ---------- Career Setup: configure the career, not the build ----------
// Division, actual height/reach, and debut era used to all be re-picked
// here, disconnected from the fighter that was actually just drafted --
// three extra decisions redoing something already decided. Division and
// physicals now come straight from the draft (the weight class it was
// rolled in, and the real height/reach of whoever got picked for those two
// rounds), and debut era is gone outright -- there's no era-specific rules
// or real-fighter pool behind it, so it was a choice with nothing riding
// on it. What's left is the one real decision: fighting style.
function CareerSetupPanel({ savedBuilds, currentPicks, currentName, currentDivision, currentMode, onLaunch, onBack }) {
  const [selectedId, setSelectedId] = useState(currentPicks ? "__current__" : (savedBuilds[0] && savedBuilds[0].id) || null);

  // Resolve whichever build is selected into a { picks, name, division } shape.
  const resolved = (() => {
    if (selectedId === "__current__" && currentPicks) {
      // originMode travels with whichever build actually gets launched, not
      // with the app's live `mode` value at click time -- picking a SAVED
      // build here shouldn't inherit whatever mode an unrelated abandoned
      // draft left lying around (see App.jsx's goHome for the other half
      // of this fix). "Just drafted" is the one case where the live mode
      // genuinely IS this build's own origin.
      return { picks: currentPicks, name: currentName, division: currentDivision || null, originMode: currentMode || "classic" };
    }
    const b = savedBuilds.find((x) => x.id === selectedId);
    if (!b) return null;
    const picks = {};
    (b.picks || []).forEach((p) => { picks[p.key] = { fighter: p.fighter, display: p.display, scoreValue: p.scoreValue, raw: p.raw }; });
    return { picks, name: b.fighterName, goatScore: b.goatScore, division: b.division || null, originMode: b.mode || "classic" };
  })();

  const base = resolved ? (() => {
    const o = {};
    SKILL_KEYS.forEach((k) => { o[k] = (resolved.picks[k] && resolved.picks[k].scoreValue) || 75; });
    return o;
  })() : null;

  const [name, setName] = useState(currentName || "");
  const [style, setStyle] = useState(null);
  const naturalFit = base ? bestFitArchetypeFlat(base) : null;

  // Locked in from the draft -- a build saved before this changed (or one
  // whose HEIGHT/REACH rounds somehow didn't resolve a real fighter) falls
  // back to its division's typical build rather than leaving a gap.
  const division = (resolved && resolved.division) || "Lightweight";
  const classPhys = CLASS_PHYSICALS[division] || CLASS_PHYSICALS.Lightweight;
  const heightIn = (resolved && resolved.picks.HEIGHT && resolved.picks.HEIGHT.raw) || Math.round(classPhys.ht);
  const reachIn = (resolved && resolved.picks.REACH && resolved.picks.REACH.raw) || Math.round(classPhys.rc);

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

      {/* Locked in from the draft, not a choice made here -- shown so it's
          still visible, just not editable. */}
      <div className="setup-locked-row mono">
        <Ruler size={13} />
        <span>{division}</span>
        <span className="setup-locked-sep">&middot;</span>
        <span>{formatHeight(heightIn)}</span>
        <span className="setup-locked-sep">&middot;</span>
        <span>{formatReach(reachIn)} reach</span>
      </div>

      <div className="setup-block">
        <div className="setup-label">Fighting Style</div>
        <div className="style-option-list">
          {[...ARCHETYPES.filter((a) => a.name !== "Balanced"), { name: "Balanced", mult: {} }].map((a) => {
            // Archetype effective-stat audit: the old chips here multiplied
            // base x ARCHETYPES.mult and showed the raw product (e.g. "POW
            // 96->106") -- a number that never existed anywhere in the
            // engine. The real in-fight style bonus (see prepareFight) is a
            // flat +3 to these same attributes, clamped to 30-99, and ONLY
            // applied when this style is the fighter's natural fit; an
            // off-style pick gets no combat-stat change at all. Rather than
            // show a number that was never real (or a real one that's only
            // true for one specific card), this names what the style
            // leans on and gives up -- qualitative, not a fabricated value.
            const boosts = Object.entries(a.mult || {}).filter(([, m]) => m > 1).map(([key]) => key);
            const sacrifices = Object.entries(a.mult || {}).filter(([, m]) => m < 1).map(([key]) => key);
            return (
              <button key={a.name} className={`style-option ${style === a.name ? "active" : ""}`} onClick={() => { sfx("select"); setStyle(a.name); }}>
                <div className="style-option-top">
                  <span className="style-option-name">{a.name}</span>
                  {a.name === naturalFit && <span className="style-fit-tag">NATURAL FIT</span>}
                </div>
                <div className="style-option-desc">{STYLE_DESCRIPTIONS[a.name]}</div>
                {(boosts.length > 0 || sacrifices.length > 0) && (
                  <div className="style-option-tradeoffs">
                    {boosts.length > 0 && (
                      <div className="style-option-tradeoff-row up">
                        <span className="style-option-tradeoff-label mono">Boosts</span>
                        <span>{boosts.map((k) => ATTR_BY_KEY[k].label).join(", ")}</span>
                      </div>
                    )}
                    {sacrifices.length > 0 && (
                      <div className="style-option-tradeoff-row down">
                        <span className="style-option-tradeoff-label mono">Sacrifices</span>
                        <span>{sacrifices.map((k) => ATTR_BY_KEY[k].label).join(", ")}</span>
                      </div>
                    )}
                  </div>
                )}
              </button>
            );
          })}
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
          division,
          // No era picker anymore -- always debuts "now," since nothing in
          // the sim actually varies by era.
          debutEra: "2020s",
          careerStyle: style || "Balanced",
          actualHeight: heightIn, actualReach: reachIn,
          originMode: resolved.originMode,
        })}
      >
        <Trophy size={16} /> Begin Career
      </button>
    </div>
  );
}

export default CareerSetupPanel;
