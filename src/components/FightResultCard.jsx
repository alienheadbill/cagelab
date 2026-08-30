import React from "react";
import { Crown, AlertTriangle, Mic, TrendingUp, TrendingDown, Zap } from "lucide-react";
import { ATTR_BY_KEY } from "../data/attrs.js";
import { clfTier, TRAIT_DEFS, rankLabel } from "../lib/career.js";

// ---------- Camp Planning decision panel ----------
// ---------- Fight result card: W/L badge + collapsible stat breakdown ----------
function FightResultCard({ e, playerName }) {
  const isTitle = e.titleShot || e.titleDefense;
  const matchupWarn = e.matchup && (e.matchup.label === "Dangerous Matchup" || e.matchup.label === "Nightmare Matchup");
  const stats = e.stats;
  const tier = clfTier(e.circuitTier);
  // A finish should read with more weight than a decision -- not a scoring
  // change, just a louder presentation for the fights that earned it.
  const isFinish = e.method.startsWith("KO/TKO") || e.method.startsWith("Submission");

  // Broadcast-style result line: "R2 3:42" for finishes, method for decisions.
  const resultLine = stats && stats.finishRound
    ? `R${stats.finishRound} ${stats.finishTime || ""}`.trim()
    : stats ? `${stats.totalRounds} RDS` : "";

  // rankBefore/rankAfter are raw rankPoints (+ champion flags), same
  // convention as the yearEnd recap -- only worth a line when the label
  // actually moved, so a string of "still Unranked" fights doesn't clutter
  // every card.
  const rankBeforeLabel = e.rankBefore != null ? rankLabel(e.rankBefore, e.championBefore) : null;
  const rankAfterLabel = e.rankAfter != null ? rankLabel(e.rankAfter, e.championAfter) : null;
  const rankMoved = rankBeforeLabel && rankAfterLabel && rankBeforeLabel !== rankAfterLabel;
  const rankImproved = rankMoved && (e.championAfter || (!e.championBefore && e.rankAfter > e.rankBefore));

  return (
    <div className={`event-card-wrap ${isTitle ? "title-event" : ""} ${e.win ? "won" : "lost"} ${isFinish ? "finish" : "decision"}`}>
      {/* Event header -- every fight is a card on a numbered CLF event */}
      <div className="event-header">
        <div className="event-name mono">CLF {e.eventNumber} &middot; {tier.short}</div>
        <div className={`event-position mono ${e.cardPosition === "MAIN EVENT" ? "headline" : ""}`}>{e.cardPosition}</div>
      </div>

      {isTitle && (
        <div className="event-title-strap">
          <Crown size={14} />
          {e.shortNotice ? "SHORT-NOTICE TITLE FIGHT" : e.titleShot ? "FOR THE TITLE" : "TITLE DEFENSE"}
        </div>
      )}

      {/* The tale of the tape -- you vs them, with the result between.
          Both corners mirror the same shape: name is the anchor, a short
          label above it (rank/status), then record + OVR (+ archetype for
          the opponent) as secondary metadata underneath -- not stacked
          above the name, where it used to read as clutter. */}
      <div className="event-matchup">
        <div className="event-corner you">
          <div className="corner-label mono">{e.onStyle === false ? "OFF-STYLE" : "YOU"}</div>
          <div className="corner-name">{playerName}</div>
          {e.playerRecord && (
            <div className="corner-sub mono">
              {e.playerRecord.w}-{e.playerRecord.l}{e.playerOverall != null ? ` · ${e.playerOverall} OVR` : ""}
            </div>
          )}
        </div>
        <div className="event-verdict">
          <div className={`event-wl ${e.win ? "win" : "loss"} ${isFinish ? "finish" : ""}`}>{e.win ? "W" : "L"}</div>
          <div className="event-method mono">{isFinish && <Zap size={11} />}{e.method.replace(" Loss", "")}</div>
          {resultLine && <div className="event-result-line mono">{resultLine}</div>}
        </div>
        <div className="event-corner opp">
          <div className="corner-label mono">
            {e.oppRank === 0 ? "CHAMPION" : e.oppRank ? `#${e.oppRank}` : "UNRANKED"}
          </div>
          <div className="corner-name">{e.opp}</div>
          <div className="corner-sub mono">
            {e.oppRecord ? `${e.oppRecord.w}-${e.oppRecord.l} · ` : ""}{e.oppRating} OVR{e.archetype ? ` · ${e.archetype}` : ""}
          </div>
        </div>
      </div>

      {rankMoved && (
        <div className={`rank-move-row ${rankImproved ? "up" : "down"}`}>
          {rankImproved ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
          {rankBeforeLabel} &rarr; {rankAfterLabel}
        </div>
      )}

      {e.matchup && (
        <div className={`matchup-line ${matchupWarn ? "warn" : ""}`}>
          {matchupWarn && <AlertTriangle size={12} />}
          Your {ATTR_BY_KEY[e.matchup.yourStrength.key].label} {Math.round(e.matchup.yourStrength.value)} vs their {ATTR_BY_KEY[e.matchup.oppStrength.key].label} {Math.round(e.matchup.oppStrength.value)} &mdash; {e.matchup.label}
        </div>
      )}

      {e.narrative && (
        <div className="fight-narrative">
          {e.narrative.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}

      {/* Breakdown is always visible now -- every fight should feel like an
          event, not a row you have to click to unfold. */}
      {stats && (
        <div className="fight-breakdown">
          {stats.scorecards && (
            <div className="scorecards-row">
              <span className="scorecard-label mono">JUDGES</span>
              {stats.scorecards.map((sc, i) => (
                <span className="scorecard-chip mono" key={i}>{sc.player}&ndash;{sc.opp}</span>
              ))}
            </div>
          )}
          <div className="stat-compare-grid">
            <div className="stat-compare-row"><b>{stats.player.sigStrikes}</b><span>Sig. Strikes</span><b>{stats.opp.sigStrikes}</b></div>
            <div className="stat-compare-row"><b>{stats.player.takedowns}</b><span>Takedowns</span><b>{stats.opp.takedowns}</b></div>
            <div className="stat-compare-row"><b>{stats.player.controlPct}%</b><span>Control</span><b>{stats.opp.controlPct}%</b></div>
            <div className="stat-compare-row"><b>{stats.player.knockdowns}</b><span>Knockdowns</span><b>{stats.opp.knockdowns}</b></div>
          </div>
        </div>
      )}

      {(e.rivalry || e.statement || e.bonusType || (e.playerTraits && e.playerTraits.length > 0)) && (
        <div className="fight-bottom-row">
          <div className="fight-tags">
            {e.rivalry && <div className="fight-tag rivalry">RIVALRY</div>}
            {e.statement && <div className="fight-tag statement">STATEMENT WIN</div>}
            {e.bonusType === "performance" && <div className="fight-tag bonus">PERFORMANCE BONUS</div>}
            {e.bonusType === "fotn" && <div className="fight-tag bonus">FIGHT OF THE NIGHT</div>}
            {(e.playerTraits || []).map((t) => (
              <div className="fight-tag trait" key={t} title={TRAIT_DEFS[t] ? TRAIT_DEFS[t].desc : ""}>
                {TRAIT_DEFS[t] ? TRAIT_DEFS[t].label : t}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Post-fight mic-in-face soundbite -- generated from the same result
          the narrative above already read from, just in the fighter's own
          voice instead of broadcast third-person. */}
      {e.interview && (
        <div className="interview-line">
          <Mic size={13} />
          <span>{e.interview}</span>
        </div>
      )}
    </div>
  );
}

export default FightResultCard;
