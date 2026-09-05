import React from "react";
import { ATTRS } from "../data/attrs.js";
import { applyAging } from "../lib/career.js";

// Fight Result + Retirement cleanup, items 4-5: the one live-attribute
// source of truth, shared between the in-career Stats tab and the
// retirement screen's Final Fighter section -- both need the exact same
// computation, so it exists once instead of twice (no shadow copy, no
// drift). "Final attribute" is explicitly applyAging(base, year, wear) --
// the fighter's actual live value including legitimate Camp development
// AND aging/wear, never raw base and never the original draftBase --
// draftBase is read only for the delta shown alongside it.
function FinalAttributesGrid({ careerState }) {
  const live = applyAging(careerState.base, careerState.year, careerState.wear);
  return (
    <div className="current-fighter-grid mono">
      {ATTRS.map((a) => {
        const isPhysical = a.key === "HEIGHT" || a.key === "REACH";
        const current = a.key === "HEIGHT" ? careerState.heightScore : a.key === "REACH" ? careerState.reachScore : live[a.key];
        const draft = a.key === "HEIGHT" ? careerState.heightScore : a.key === "REACH" ? careerState.reachScore : careerState.draftBase[a.key];
        const curR = Math.round(current);
        const delta = curR - Math.round(draft);
        return (
          <div className="current-fighter-row" key={a.key}>
            <span className="current-fighter-label">{a.label}</span>
            <span className="current-fighter-value">
              {curR}
              {!isPhysical && delta !== 0 && (
                <span className={delta > 0 ? "good-text" : "bad-text"}> ({delta > 0 ? "+" : ""}{delta})</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default FinalAttributesGrid;
