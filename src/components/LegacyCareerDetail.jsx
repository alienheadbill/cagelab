import React from "react";
import { ArrowLeft, Crown } from "lucide-react";
import { CLF_TIERS, rankLabel } from "../lib/career.js";
import AttributeBarList from "./AttributeBarList.jsx";

// "Not recorded" rather than a blank or a fabricated value -- this view has
// to render careers saved before this data existed just as gracefully as
// ones saved after.
// Reuses the same stat-box/stat-num/stat-lbl language the Stats tab
// already uses -- no new visual system for this screen.
function Stat({ label, value }) {
  return (
    <div className="stat-box">
      <div className="stat-num">{value == null || value === "" ? "—" : value}</div>
      <div className="stat-lbl">{label}</div>
    </div>
  );
}

// Reopens one historical career. Everything here reads from the immutable
// snapshot saveCareerToHistory took the moment that career ended -- this
// never recomputes GOAT Score, Build Value, or ranking from current
// formulas, so a career saved before a balance pass reads exactly as it
// did the day it finished.
function LegacyCareerDetail({ career: c, onBack }) {
  const hasPeak = c.peakPlayerRank !== undefined && c.peakPlayerRank !== null;
  const peakRankLabel = hasPeak ? rankLabel(c.peakPlayerRank, c.peakPlayerRank === 0) : "Not recorded";
  const peakTier = c.peakCircuitTier ? (CLF_TIERS.find((t) => t.name === c.peakCircuitTier) || {}).short || c.peakCircuitTier : "Not recorded";

  // Reconstruct the keyed picks shape AttributeBarList expects from the
  // flat stored array -- same conversion loadSavedBuild already does for a
  // saved Build, reused here so a historical career's build renders
  // through the identical, already-trusted presentation.
  const restoredPicks = {};
  (c.picks || []).forEach((p) => {
    restoredPicks[p.key] = { fighter: p.fighter, display: p.display, scoreValue: p.scoreValue, raw: p.raw };
  });
  const hasBuild = (c.picks || []).length > 0;

  return (
    <div className="legacy-detail">
      <button className="text-btn legacy-detail-back" onClick={onBack}><ArrowLeft size={13} /> Back to Legacy</button>

      <div className="legacy-detail-head">
        <div className="legacy-detail-name display">{c.fighterName}</div>
        <div className="legacy-detail-sub">
          {c.division || "Division not recorded"}{c.careerStyle ? ` · ${c.careerStyle}` : ""}
        </div>
        {(c.champion || c.titleReigns > 0) && (
          <div className="legacy-detail-champ-badge"><Crown size={12} /> {c.champion ? "Retired as Champion" : "Former Champion"}</div>
        )}
      </div>

      <div className="collection-block-title">Fighter</div>
      <div className="stat-grid">
        <Stat label="GOAT Score" value={c.goatScore} />
        <Stat label="Build Value" value={c.buildValue} />
        <Stat label="Legacy Score" value={c.legacyScore} />
      </div>
      <div className="legacy-detail-verdict">{c.verdict}</div>

      <div className="collection-block-title" style={{ marginTop: 14 }}>Career</div>
      <div className="stat-grid">
        <Stat label="Record" value={`${c.record.w}-${c.record.l}`} />
        <Stat label="Total Fights" value={c.totalFightCount} />
        <Stat label="Peak Division" value={peakTier} />
        <Stat label="Peak Rank" value={peakRankLabel} />
        <Stat label="Title Reigns" value={c.titleReigns} />
        <Stat label="Title Defenses" value={c.titleDefenses} />
        <Stat label="Longest Streak" value={c.longestStreak} />
        <Stat label="Rivalries Won" value={c.rivalryWins} />
        <Stat label="Statement Wins" value={c.statementWins} />
        {c.wonTitleAsUnderdog && <Stat label="Underdog Title" value="Yes" />}
      </div>

      <div className="collection-block-title" style={{ marginTop: 14 }}>Build</div>
      {hasBuild ? (
        <AttributeBarList picks={restoredPicks} />
      ) : (
        <div className="empty-txt">This career was saved before build attributes were recorded — not available for this one.</div>
      )}
    </div>
  );
}

export default LegacyCareerDetail;
