import React from "react";
import { Crown } from "lucide-react";
import { CLF_TIERS, VERDICT_ORDER, rankLabel } from "../lib/career.js";

// Presentation-only bucketing of the EXISTING 7-tier verdict ladder into the
// same 4-step bronze/silver/gold/legend visual language already used
// everywhere else (pick cards, GOAT tier badge) -- not a new grading
// algorithm, just a reuse of one that already exists, applied to a field
// (verdict) that already exists.
function verdictWeightCls(verdict) {
  const idx = VERDICT_ORDER.indexOf(verdict);
  if (idx >= 5) return "legacy-legend";   // First-Ballot Hall of Famer, Generational Talent
  if (idx >= 3) return "legacy-gold";     // Fringe Hall of Famer, Hall of Fame
  if (idx >= 2) return "legacy-silver";   // Legitimate Contender
  return "legacy-bronze";                 // Journeyman, Prospect Who Never Broke Through
}

// Same one-line mapping App.jsx's own tierRampCls uses for circuit tier
// badges -- copied rather than imported since it's a one-liner and
// CollectionScreen doesn't otherwise share App.jsx's local helpers.
function tierRampCls(tierName) {
  return `tier-ramp-${Math.max(0, CLF_TIERS.findIndex((t) => t.name === tierName))}`;
}

// Highest-tier reign actually won, Premier > National > Regional. Only
// ever computed off titleReignsByTier -- an entry saved before that field
// existed (see saveCareerToHistory) returns null here and the caller
// falls back to the original generic Champion/Former Champion badge,
// never a guessed tier.
function highestTitleTier(c) {
  if (!c.titleReignsByTier) return null;
  if (c.titleReignsByTier["CLF PREMIER"] > 0) return "CLF PREMIER";
  if (c.titleReignsByTier["CLF National"] > 0) return "CLF National";
  if (c.titleReignsByTier["CLF Regional"] > 0) return "CLF Regional";
  return null;
}

// A glanceable "how great was this career" card, sorted by the caller on
// legacyScore DESC -- CageLab's own existing holistic career-greatness
// number, not a new one invented for this screen. Deliberately tolerant of
// older history entries that predate this data (peakPlayerRank,
// peakCircuitTier, division, careerStyle, champion, goatScore, buildValue,
// picks) -- those simply don't render their row rather than showing a
// fabricated or crashing value.
function LegacyCareerCard({ career: c, onOpen }) {
  const weightCls = verdictWeightCls(c.verdict);
  const hasPeak = c.peakPlayerRank !== undefined && c.peakPlayerRank !== null;
  const peakLabel = hasPeak ? rankLabel(c.peakPlayerRank, c.peakPlayerRank === 0) : null;

  return (
    <button className={`legacy-card ${weightCls}`} onClick={onOpen}>
      <div className="legacy-card-top">
        <div className="legacy-card-name">{c.fighterName}</div>
        <div className="legacy-card-score">
          <span className="legacy-card-score-num mono">{c.legacyScore}</span>
          <span className="legacy-card-score-lbl">LEGACY</span>
        </div>
      </div>
      <div className="legacy-card-sub">
        {c.record.w}-{c.record.l} &middot; {c.verdict}
      </div>

      {(c.goatScore != null || c.buildValue != null) && (
        <div className="legacy-card-stats mono">
          {c.goatScore != null && <span><b>{c.goatScore}</b> GOAT</span>}
          {c.buildValue != null && <span><b>{c.buildValue}</b> BUILD VALUE</span>}
        </div>
      )}

      <div className="legacy-card-tags">
        {c.peakCircuitTier && (
          <span className={`fight-tier-tag ${tierRampCls(c.peakCircuitTier)}`}>
            Reached {(CLF_TIERS.find((t) => t.name === c.peakCircuitTier) || {}).short || c.peakCircuitTier}
          </span>
        )}
        {peakLabel && <span className="fight-tier-tag legacy-rank-tag">Peak {peakLabel}</span>}
        {(() => {
          const topTier = highestTitleTier(c);
          if (topTier) {
            const t = CLF_TIERS.find((x) => x.name === topTier) || {};
            return <span className="fight-tier-tag legacy-champ-tag"><Crown size={10} /> CLF {t.short} CHAMPION</span>;
          }
          // No tier breakdown recorded (older entry) -- unchanged generic
          // fallback, never a guessed tier.
          return (c.champion || c.titleReigns > 0) && (
            <span className="fight-tier-tag legacy-champ-tag"><Crown size={10} /> {c.champion ? "Champion" : "Former Champion"}</span>
          );
        })()}
        {c.division && <span className="fight-tier-tag legacy-division-tag">{c.division}</span>}
      </div>
    </button>
  );
}

export default LegacyCareerCard;
