import React from "react";
import { CheckCircle2 } from "lucide-react";
import { ATTR_BY_KEY } from "../data/attrs.js";
import { CAMP_FOCUSES } from "../lib/career.js";

// Training Camp Rework V1, item 13: reuses the existing Camp tab/panel --
// no new route/modal. Shown once, right after "Begin Camp", from the
// state resolveCampPlanning already produced (state.lastCampResult) -- no
// second calculation, just the real before/after numbers.
function CampCompletePanel({ result, onContinue }) {
  if (!result) return null;
  const def = CAMP_FOCUSES[result.focus];
  const round1 = (n) => Math.round(n * 10) / 10;
  return (
    <div className="decision-panel">
      <div className="decision-title"><CheckCircle2 size={15} /> Camp Complete</div>
      <div className="decision-sub">{def ? def.label : "Camp"}</div>

      <div className="camp-result-grid mono">
        <div className="camp-result-row">
          <span className="camp-result-label">{ATTR_BY_KEY[result.primaryAttr].label}</span>
          <span className="camp-result-value">{round1(result.primaryBefore)} → {round1(result.primaryAfter)}</span>
        </div>
        {result.secondaryAttr && (
          <div className="camp-result-row">
            <span className="camp-result-label">{ATTR_BY_KEY[result.secondaryAttr].label}</span>
            <span className="camp-result-value">{round1(result.secondaryBefore)} → {round1(result.secondaryAfter)}</span>
          </div>
        )}
        {result.wearRecovered && (
          <div className="camp-result-row">
            <span className="camp-result-label">Recovery</span>
            <span className="camp-result-value good-text">Wear reduced</span>
          </div>
        )}
      </div>

      <button className="btn btn-dark" style={{ marginTop: 14 }} onClick={onContinue}>Continue</button>
    </div>
  );
}

export default CampCompletePanel;
