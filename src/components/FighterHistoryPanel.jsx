import React, { useState } from "react";
import { ArrowLeft, Crown } from "lucide-react";
import { getFighterHistory } from "../lib/universeHistory.js";

// Fighter History V1 -- "who is this fighter, what was their TRACKED
// record, who did they fight, how did their rank move, what were their
// big results." Everything here reads getFighterHistory's already-
// computed view model; nothing here re-derives anything from current
// live state.
//
// Section 25 of the underlying task: NPC fighters begin universe life
// with a synthetic pre-tracking record (they didn't spring into
// existence 0-0 the day the ledger started), so the ledger-derived
// numbers here are explicitly labeled TRACKED, never "Career Record" --
// that would overclaim a completeness this data doesn't have.
function rankLine(rankBefore) {
  if (rankBefore === 0) return "Champion";
  if (rankBefore == null) return "Unranked";
  return `#${rankBefore}`;
}

function FightRow({ fight, onOpenFighter }) {
  return (
    <div className="fh-fight-row">
      <div className="fh-fight-top">
        <span className={`fh-fight-result mono ${fight.win ? "win" : "loss"}`}>{fight.win ? "W" : "L"}</span>
        <button
          type="button"
          className="ue-fighter-name-btn"
          onClick={() => onOpenFighter(fight.oppId)}
          aria-label={`Open fight history for ${fight.opponent.name}`}
        >
          {fight.opponent.isPlayer ? `${fight.opponent.name} (You)` : fight.opponent.name}
        </button>
        {fight.titleFight && <Crown size={11} className="fh-fight-title-icon" aria-label="Title fight" />}
      </div>
      <div className="fh-fight-meta mono">
        {fight.event ? fight.event.id : "Legacy Event"}{fight.event && fight.event.derived ? " ·r" : ""} &middot; {fight.division || "—"} &middot; Year {fight.year}
      </div>
      <div className="fh-fight-meta mono">
        {rankLine(fight.myRankBefore)} vs {rankLine(fight.oppRankBefore)} &middot; {fight.method}, R{fight.round}
      </div>
    </div>
  );
}

function FighterHistoryPanel({ history, fighterId, onOpenFighter, onBack }) {
  const [showAll, setShowAll] = useState(false);
  const fh = React.useMemo(() => getFighterHistory(history, fighterId), [history, fighterId]);
  const visibleFights = showAll ? fh.fights : fh.fights.slice(0, 10);

  return (
    <div className="fh-panel">
      <div className="section-head-row">
        <button className="icon-btn" onClick={onBack} aria-label="Back"><ArrowLeft size={16} /></button>
        <div className="attr-name">{fh.name}{fh.isPlayer ? " (You)" : ""}</div>
      </div>

      <div className="fh-sub mono">
        {fh.archetype || "—"}
        {fh.isCS && " · Contender Series opponent"}
        {fh.isHistorical && " · previous weight class"}
      </div>

      <div className="stat-grid" style={{ marginTop: 10 }}>
        <div className="stat-box"><div className="stat-num">{fh.trackedRecord.w}-{fh.trackedRecord.l}</div><div className="stat-lbl">Tracked Record</div></div>
        <div className="stat-box"><div className="stat-num">{fh.trackedFightCount}</div><div className="stat-lbl">Tracked CLF Fights</div></div>
        <div className="stat-box"><div className="stat-num">{fh.peakRankLabel}</div><div className="stat-lbl">Peak Observed Rank</div></div>
      </div>

      {fh.baselineRecord && (
        <div className="help-text" style={{ marginTop: 8 }}>
          Entered tracked universe at <b>{fh.baselineRecord.w}-{fh.baselineRecord.l}</b>
          {fh.finalOrCurrentRecord && <> &middot; now <b>{fh.finalOrCurrentRecord.w}-{fh.finalOrCurrentRecord.l}</b></>}
          {" "}(pre-tracking record not part of this ledger).
        </div>
      )}

      <div className="collection-block-title" style={{ marginTop: 14 }}>Tracked Fight History</div>
      {fh.fights.length === 0 ? (
        <div className="empty-txt">No tracked CLF fights recorded for this fighter yet.</div>
      ) : (
        <>
          {visibleFights.map((f) => <FightRow key={f.boutId} fight={f} onOpenFighter={onOpenFighter} />)}
          {fh.fights.length > 10 && !showAll && (
            <button type="button" className="text-btn" onClick={() => setShowAll(true)}>
              View all {fh.fights.length} tracked fights
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default FighterHistoryPanel;
