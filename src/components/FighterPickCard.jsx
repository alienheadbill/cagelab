import React from "react";
import { ATTR_BY_KEY, RELATED_ATTRS } from "../data/attrs.js";
import { tierOf, relativeHeightScore, relativeReachScore } from "../lib/scoring.js";
import { formatHeight, formatReach } from "../lib/utils.js";
import TierIcon from "./TierIcon.jsx";

// ---------- Restyled fighter pick card (colored header band, tier icon, related-stat mini bars) ----------
function FighterPickCard({ fighter, currentAttrKey, index, blind, value, selected, disabled, onPick }) {
  const attr = ATTR_BY_KEY[currentAttrKey];
  const tier = tierOf(value.scoreValue);
  // Header color is driven by the actual rating tier -- bronze/silver/gold/legendary --
  // so color communicates quality at a glance instead of just rotating for variety.
  const band = blind ? "pc-blind" : `pc-${tier.cls.replace("tier-", "")}`;
  const related = RELATED_ATTRS[currentAttrKey] || [];

  function relatedValue(key) {
    const relAttr = ATTR_BY_KEY[key];
    if (relAttr.kind === "height") return relativeHeightScore(fighter.ht, fighter.wc);
    if (relAttr.kind === "reach") return relativeReachScore(fighter.rc, fighter.wc);
    return fighter[key];
  }

  return (
    <div
      className={`pick-card ${band} ${selected ? "selected" : ""} ${disabled && !selected ? "dimmed" : ""}`}
      onClick={disabled ? undefined : onPick}
      role="button" tabIndex={disabled ? -1 : 0}
      aria-label={`Pick ${fighter.n}, ${attr.label} ${blind ? "hidden" : value.display}`}
      onKeyDown={(e) => { if (!disabled && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onPick(); } }}
    >
      <div className="pick-card-header">
        <div className="pick-card-abbr mono">{attr.abbr}</div>
        <div className="pick-card-num">{blind ? "?" : value.display}</div>
        {!blind && <div className="pick-card-tier"><TierIcon cls={tier.cls} size={13} /></div>}
      </div>
      <div className="pick-card-body">
        <div className="pick-card-name">{fighter.n}</div>
        <div className="pick-card-sub">
          {blind
            ? `${fighter.wc} · ${fighter.era}`
            : `${formatHeight(fighter.ht)} / ${formatReach(fighter.rc)} · ${fighter.wc} · ${fighter.era}`}
        </div>
        {!blind && value.relativeNote && <div className="pick-card-note">{value.relativeNote}</div>}
        {!blind && related.length > 0 && (
          <div className="pick-card-bars">
            {related.map((rk) => {
              const rv = relatedValue(rk);
              const pct = Math.max(4, Math.round(((rv - 50) / 49) * 100));
              return (
                <div className="pick-mini-bar-row" key={rk}>
                  <span>{ATTR_BY_KEY[rk].abbr}</span>
                  <div className="pick-mini-bar-track"><div className="pick-mini-bar-fill" style={{ width: `${pct}%` }} /></div>
                  <span className="mono">{rv}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default FighterPickCard;
