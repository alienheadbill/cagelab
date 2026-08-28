import React from "react";
import { ATTRS } from "../data/attrs.js";

// Full 10-attribute breakdown, sorted strongest-to-weakest with the real
// fighter attribution kept (the "10 fighters became 1" feature doesn't get
// lost just because the presentation got more premium).
function AttributeBarList({ picks }) {
  const rows = ATTRS.map((a) => ({ key: a.key, label: a.label, value: picks[a.key].scoreValue, fighter: picks[a.key].fighter, display: picks[a.key].display }))
    .sort((a, b) => b.value - a.value);
  const maxVal = rows[0].value;
  const minVal = rows[rows.length - 1].value;
  return (
    <div className="attr-bar-list">
      {rows.map((r) => {
        const pct = Math.max(4, Math.round(((r.value - 50) / 49) * 100));
        const isBest = r.value === maxVal;
        const isWorst = r.value === minVal && !isBest;
        return (
          <div className={`attr-bar-row ${isBest ? "best" : ""} ${isWorst ? "worst" : ""}`} key={r.key}>
            <div className="attr-bar-top">
              <span className="attr-bar-label">
                {isBest && <span className="attr-marker best-marker">▲ BEST</span>}
                {isWorst && <span className="attr-marker worst-marker">▼ WEAK</span>}
                {r.label}
              </span>
              <span className="attr-bar-value mono">{r.display}</span>
            </div>
            <div className="attr-bar-track"><div className="attr-bar-fill" style={{ "--pct": `${pct}%` }} /></div>
            <div className="attr-bar-fighter">via {r.fighter}</div>
          </div>
        );
      })}
    </div>
  );
}

export default AttributeBarList;
