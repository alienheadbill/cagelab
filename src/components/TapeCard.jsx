import React, { useEffect, useRef, useState } from "react";
import { Eye, TrendingUp, TrendingDown } from "lucide-react";
import { ATTRS, ATTR_BY_KEY } from "../data/attrs.js";
import { estimateGoatSoFar } from "../lib/scoring.js";

// ---------- Tale of the tape build panel (blind-aware) ----------
// lastPick ({key, value}) and newestSlotKey are both sourced from App.jsx's
// single lastPick state, set the instant a pick actually commits -- not
// derived from `round`, so the caption and the slot grid can never
// disagree about which pick is "current" the way an order[round-2]-based
// lookup could (it only advanced a full round transition late).
function TapeCard({ name, picks, blind, modeChip, lastPick, newestSlotKey, compact, editableName, nameValue, onChangeName }) {
  const filledCount = Object.keys(picks).length;
  const fillPct = filledCount / ATTRS.length;
  const liveGoat = estimateGoatSoFar(picks);

  // Answers "what did that pick just do" directly instead of leaving the
  // player to notice the estimate moved and do the subtraction themselves --
  // NUMBERS -> INTERPRETATION. Tracked locally off the same liveGoat value
  // TapeCard already derives, so nothing upstream needs to change.
  const [delta, setDelta] = useState(null);
  const prevGoatRef = useRef(liveGoat);
  useEffect(() => {
    if (liveGoat != null && prevGoatRef.current != null && liveGoat !== prevGoatRef.current) {
      setDelta(liveGoat - prevGoatRef.current);
      const t = setTimeout(() => setDelta(null), 2200);
      prevGoatRef.current = liveGoat;
      return () => clearTimeout(t);
    }
    prevGoatRef.current = liveGoat;
    return undefined;
  }, [liveGoat]);
  const caption = filledCount >= ATTRS.length
    ? "BUILD COMPLETE"
    : lastPick
      ? `${ATTR_BY_KEY[lastPick.key].label.toUpperCase()}: ${blind ? lastPick.value.fighter.split(" ")[0] : lastPick.value.fighter} (${blind ? "?" : lastPick.value.display})`
      : "— AWAITING FIRST PICK —";

  // Read-only scouting summary (Draft Focus + Clarity, gold direction):
  // revealed attributes only, best/weak-spot callout. Deliberately plain
  // label/value text -- never boxed like FighterPickCard -- so this panel
  // reads as a scouting readout, not a second menu next to the real,
  // clickable draft board. This IS the centerpiece now -- a decorative
  // fighter silhouette was tried and cut after review read as clutter
  // competing with it; watching real attributes accumulate here as you
  // pick is the part worth keeping.
  const revealed = !blind
    ? ATTRS.filter((a) => picks[a.key])
        .map((a) => ({ key: a.key, label: a.label, value: picks[a.key].scoreValue, fighter: picks[a.key].fighter, display: picks[a.key].display }))
        .sort((x, y) => y.value - x.value)
    : [];
  const best = revealed[0] || null;
  const worst = revealed.length > 1 ? revealed[revealed.length - 1] : null;

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
              {/* Keyed on the value itself so it remounts (and re-plays its
                  pulse animation) on every real change -- same pattern as
                  the Career screen's legacy-num. */}
              <span className="live-goat-num mono" key={blind ? "blind" : liveGoat}>{blind ? "?" : liveGoat}</span>
              <span className="live-goat-lbl">EST</span>
              {/* Blind mode hides this too -- a delta would leak exactly
                  what the hidden number itself would (see comment above). */}
              {!blind && delta != null && delta !== 0 && (
                <span className={`live-goat-delta mono ${delta > 0 ? "up" : "down"}`}>
                  {delta > 0 ? `+${delta}` : delta}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className={`build-board ${compact ? "compact" : ""}`}>
        <div className="build-board-text">
          <div className="build-board-caption mono">{caption}</div>
          <div className="build-board-progress mono">{filledCount} / {ATTRS.length} ATTRIBUTES DRAFTED</div>
        </div>
        <div className="progress-bar-track">
          <div className="progress-bar-fill" style={{ width: `${Math.round(fillPct * 100)}%` }} />
        </div>
      </div>

      <div className="scouting-summary">
        <div className="scouting-summary-eyebrow mono"><Eye size={11} /> Scouting Summary</div>

        {blind ? (
          <div className="scouting-note">Attribute values stay hidden until your build is complete — the shape of this fighter is a surprise.</div>
        ) : revealed.length === 0 ? (
          <div className="scouting-note">Make your first pick on the board to start this fighter's revealed profile.</div>
        ) : (
          <>
            <div className="scouting-callouts">
              {best && (
                <div className="scouting-callout-row">
                  <TrendingUp size={12} /> Best so far: <b>{best.label}</b> <span className="mono">{best.display}</span> <span className="scouting-callout-via">via {best.fighter}</span>
                </div>
              )}
              {worst && (
                <div className="scouting-callout-row weak">
                  <TrendingDown size={12} /> Weak spot: <b>{worst.label}</b> <span className="mono">{worst.display}</span> <span className="scouting-callout-via">via {worst.fighter}</span>
                </div>
              )}
            </div>
            <div className="scouting-row-list">
              {/* Each row mounts once, the moment its attribute is drafted --
                  React never remounts an existing key, so .reveal-in's one-shot
                  entrance only plays for the row that's actually new, not the
                  ones already sitting here (the part of this screen worth
                  keeping, per review: watching real picks accumulate here). */}
              {revealed.map((r) => (
                <div className={`scouting-attr-row reveal-in ${r.key === newestSlotKey ? "newest" : ""}`} key={r.key}>
                  <span className="scouting-attr-label">{r.label}</span>
                  <span className="scouting-attr-value mono">{r.display}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default TapeCard;
