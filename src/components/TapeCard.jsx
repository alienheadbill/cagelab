import React from "react";
import { ATTRS, ATTR_BY_KEY } from "../data/attrs.js";
import { estimateGoatSoFar } from "../lib/scoring.js";
import FighterSilhouette from "./FighterSilhouette.jsx";

// ---------- Tale of the tape build panel (blind-aware) ----------
function TapeCard({ name, picks, blind, modeChip, lastPickedKey, compact, editableName, nameValue, onChangeName }) {
  const filledCount = Object.keys(picks).length;
  const fillPct = filledCount / ATTRS.length;
  const lastPick = lastPickedKey ? picks[lastPickedKey] : null;
  const liveGoat = estimateGoatSoFar(picks);
  const caption = filledCount >= ATTRS.length
    ? "BUILD COMPLETE"
    : lastPick
      ? `${ATTR_BY_KEY[lastPickedKey].label.toUpperCase()}: ${blind ? lastPick.fighter.split(" ")[0] : lastPick.fighter} (${blind ? "?" : lastPick.display})`
      : "— AWAITING FIRST PICK —";

  return (
    <div className="panel tape-card">
      <div className="tape-head">
        {editableName ? (
          <input
            className="name-input-inline"
            placeholder="NAME YOUR FIGHTER"
            value={nameValue}
            onChange={(e) => onChangeName(e.target.value.toUpperCase())}
            maxLength={24}
            aria-label="Fighter name"
          />
        ) : (
          <div className="tape-name display">{name}</div>
        )}
        <div className="tape-sub-row">
          <div className="tape-sub mono">
            TALE OF THE TAPE{blind ? " • BLIND" : ""}
            {modeChip && <span className="mode-chip">{modeChip}</span>}
          </div>
          {liveGoat !== null && (
            // Blind mode hides the running estimate -- showing it would leak
            // exactly what's hidden, and diffing it between rounds would give
            // away each pick's rating outright.
            <div
              className={`live-goat ${blind ? "hidden-value" : ""}`}
              title={blind ? "Hidden in Blind mode" : "Rough estimate based on picks so far"}
            >
              <span className="live-goat-num mono">{blind ? "?" : liveGoat}</span>
              <span className="live-goat-lbl">EST</span>
            </div>
          )}
        </div>
      </div>

      <div className={`build-board ${compact ? "compact" : ""}`}>
        {!compact && <FighterSilhouette fillPct={fillPct} />}
        <div className="build-board-caption mono">{caption}</div>
      </div>

      <div className="slot-grid">
        {ATTRS.map((a) => {
          const p = picks[a.key];
          const Icon = a.icon;
          return (
            <div className={`slot-box ${p ? "filled" : ""}`} key={a.key}>
              <div className="slot-box-label"><Icon size={11} /> {a.label}</div>
              {p ? (
                <div className="slot-box-value">
                  <span className="slot-box-name">{p.fighter.split(" ").slice(-1)[0]}</span>
                  <span className="slot-box-rating mono">{blind ? "?" : p.display}</span>
                </div>
              ) : (
                <div className="slot-box-open mono">OPEN</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default TapeCard;
