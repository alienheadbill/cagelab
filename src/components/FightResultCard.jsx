import React from "react";
import { Crown, AlertTriangle, Mic, TrendingUp, TrendingDown, Zap, FlaskConical, ChevronDown } from "lucide-react";
import { ATTR_BY_KEY } from "../data/attrs.js";
import { clfTier, TRAIT_DEFS, rankLabel } from "../lib/career.js";

// Ordinal suffix for a title-defense count -- same one-liner as App.jsx's
// copy (duplicated rather than imported, matching this file's existing
// tierRampCls-style convention for small display-only helpers).
function ordinal(n) {
  const suf = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suf[(v - 20) % 10] || suf[v] || suf[0]}`;
}

// ---------- Fight result card ----------
// Hierarchy (Fight Result + Retirement cleanup, items 8-11): ALWAYS
// VISIBLE covers "did I win, how, what changed" -- event header, title/CS
// stakes, tale of tape, rank movement, the rank-achievement banner, and one
// concise How It Happened line. Everything else (round-by-round, moments,
// stat comparison, matchup scouting, tags, the interview quote) moves into
// exactly two <details> disclosures so deeper detail stays one tap away
// without ever being removed. Major fights (title/CS/rivalry/upset) default
// those disclosures OPEN; routine fights default them closed -- same
// content either way, just a different starting point, so a routine fight
// reads short and a major one still shows everything without an extra tap.
function FightResultCard({ e, playerName }) {
  const isTitle = e.titleShot || e.titleDefense;
  const matchupWarn = e.matchup && (e.matchup.label === "Dangerous Matchup" || e.matchup.label === "Nightmare Matchup");
  const stats = e.stats;
  const tier = clfTier(e.circuitTier);
  // A finish should read with more weight than a decision -- not a scoring
  // change, just a louder presentation for the fights that earned it.
  const isFinish = e.method.startsWith("KO/TKO") || e.method.startsWith("Submission");
  // A major fight gets its detail sections auto-expanded; a routine one
  // starts collapsed. Mirrors the same "major moment" list used elsewhere
  // (title shot/defense/win/loss, Contender Series, a real rivalry win, a
  // real upset) -- nothing new, just read off fields the card already has.
  const isMajorFight = isTitle || e.contenderSeries || e.rivalry || e.underdogWin;

  // FAST_STARTER is a confirmed fully-inert trait (audited: no modifier,
  // no narrative hook, nothing downstream reads it) -- deriveTraits still
  // computes it unchanged (touching that logic risks reshuffling which
  // OTHER traits a fighter gets, since the derivation caps at 4), this
  // just stops presenting it to the player as if it meant something.
  const visibleTraits = (e.playerTraits || []).filter((t) => t !== "FAST_STARTER");

  // Broadcast-style result line: "R2 3:42" for finishes, method for decisions.
  const resultLine = stats && stats.finishRound
    ? `R${stats.finishRound} ${stats.finishTime || ""}`.trim()
    : stats ? `${stats.totalRounds} RDS` : "";

  // rankBefore/rankAfter are the real division ladder position (+ champion
  // flags), same convention as the yearEnd recap -- rankLabel already
  // renders a null playerRank as "Unranked" on its own, so this is only
  // worth a line when the label actually moved, so a string of "still
  // Unranked" fights doesn't clutter every card.
  const rankBeforeLabel = rankLabel(e.rankBefore, e.championBefore);
  const rankAfterLabel = rankLabel(e.rankAfter, e.championAfter);
  const rankMoved = rankBeforeLabel !== rankAfterLabel;
  // playerRank is lower-is-better (0 = champion, null = unranked/worst),
  // the opposite of the old rankPoints scale this used to compare -- treat
  // null as the worst possible value so "Unranked -> #11" still reads as
  // an improvement.
  const rankSortValue = (r) => (r == null ? 999 : r);
  const rankImproved = rankMoved && (e.championAfter || (!e.championBefore && rankSortValue(e.rankAfter) < rankSortValue(e.rankBefore)));

  const hasBreakdown = !!((e.rounds && e.rounds.length > 0) || (e.moments && e.moments.length > 0) || (stats && stats.scorecards) || stats);
  const hasScouting = !!(e.matchup || e.rivalry || e.statement || e.bonusType || e.underdogWin || e.calledOut || visibleTraits.length > 0 || e.interview);

  return (
    <div className={`event-card-wrap ${isTitle ? "title-event" : ""} ${e.win ? "won" : "lost"} ${isFinish ? "finish" : "decision"}`}>
      {/* Event header -- every fight is a card on a numbered CLF event,
          except a Lab simulation, which was never booked on any real card
          (no eventNumber/circuitTier/cardPosition exist for it) -- the one
          place this component needed to know it might not be in a Career
          context, isolated to just this line rather than duplicating the
          rest of the card for it. */}
      <div className="event-header">
        {e.labSim ? (
          <>
            <div className="event-name mono"><FlaskConical size={12} style={{ verticalAlign: -2, marginRight: 4 }} />THE LAB</div>
            <div className="event-position mono">SIMULATION</div>
          </>
        ) : (
          <>
            <div className="event-name mono">CLF {e.eventNumber} &middot; {tier.short}</div>
            <div className={`event-position mono ${e.cardPosition === "MAIN EVENT" ? "headline" : ""}`}>{e.cardPosition}</div>
          </>
        )}
      </div>

      {/* Title context always reads off THIS fight's own stored circuitTier/
          division (fight-time truth) -- a Regional/National title win can
          promote the career away in this same commit, so careerState may
          already disagree with what actually happened here by the time
          this card renders. Challenges (win or loss) just name the real
          stakes -- the outcome itself is the milestone (on a win) or the
          W/L badge + rank-move row below (on a loss). Defenses get their
          own richer treatment: "AND STILL" with the exact defense count on
          a win, "TITLE LOST" naming the championship on a loss -- never a
          blocking milestone here, this IS the light live treatment for
          every defense that isn't 1st/3rd/5th (see career.js). */}
      {isTitle && (() => {
        const div = (e.division || "").toUpperCase();
        if (e.titleDefense) {
          return e.win ? (
            <div className="title-result-block and-still">
              <div className="title-result-eyebrow mono"><Crown size={13} /> AND STILL</div>
              <div className="title-result-tier">{tier.short} {div} CHAMPION</div>
              <div className="title-result-sub mono">{ordinal(e.titleDefenseCount).toUpperCase()} TITLE DEFENSE</div>
            </div>
          ) : (
            <div className="title-result-block title-lost">
              <div className="title-result-eyebrow mono"><Crown size={13} /> TITLE LOST</div>
              <div className="title-result-tier">{tier.short} {div} CHAMPIONSHIP</div>
            </div>
          );
        }
        return (
          <div className="event-title-strap">
            <Crown size={14} />
            {e.shortNotice ? "SHORT-NOTICE — " : ""}FOR THE {tier.short} {div} TITLE
          </div>
        );
      })()}

      {e.contenderSeries && (
        <div className="event-title-strap contender-strap">
          <Zap size={14} />
          {e.win ? "CONTENDER SERIES -- SIGNED TO PREMIER" : "CONTENDER SERIES -- SHOWCASE"}
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
          {!!e.purseGain && <div className="event-purse-line mono">+${e.purseGain}K</div>}
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

      {/* First-time-only rank achievement -- computed once in commitFight
          (firstTop5/firstNumberOne), never re-derived here. Not a milestone
          screen, doesn't repeat on later fights once it's fired once. #1
          takes priority over Top 5 on the rare fight that clears both at
          once, rather than stacking two banners for the same climb. Always
          visible -- compression must never bury this (item 12). */}
      {(e.firstNumberOne || e.firstTop5) && (
        <div className="rank-achievement-banner">
          <Crown size={12} />
          <div>
            <div className="rank-achievement-eyebrow mono">{e.firstNumberOne ? "#1 Contender" : "Top 5"}</div>
            <div className="rank-achievement-text">{e.firstNumberOne ? "Title shot within reach." : "You're in title contention."}</div>
          </div>
        </div>
      )}

      {/* "How it happened" -- a short synthesis of the whole fight's arc,
          always visible (item 9): this is the one line that actually
          answers HOW a win/loss happened, so compression never touches it.
          Only present on fights resolved after the narrative layer shipped
          (see narrative.js); older saved fights fall back to the original
          narrative lines so existing career history doesn't go blank. */}
      {e.howItHappened ? (
        <div className="fight-narrative how-it-happened">
          <div className="how-it-happened-lbl mono">How It Happened</div>
          <div>{e.howItHappened}</div>
        </div>
      ) : e.narrative && (
        <div className="fight-narrative">
          {e.narrative.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}

      {/* Disclosure 1: FIGHT BREAKDOWN -- round-by-round, fight moments,
          scorecards, the stat-compare grid. Defaults open on a major fight,
          closed on a routine one -- same content either way. */}
      {hasBreakdown && (
        <details className="fight-detail-section" open={isMajorFight}>
          <summary>Fight Breakdown <ChevronDown size={13} className="fight-detail-chevron" /></summary>
          <div className="fight-breakdown">
            {/* Round-by-round: pip (who won) + a short line explaining why,
                generated once at fight-resolution time from the actual
                per-round data (see narrative.js) -- never invented, never
                re-rolled on render. Falls back to pip-only for fights saved
                before this existed (no roundNarratives on the entry). */}
            {e.rounds && e.rounds.length > 0 && (e.roundNarratives ? (
              <div className="round-narrative-list">
                {e.rounds.map((r, i) => (
                  <div key={r.round} className={`round-narrative-row ${r.playerWon ? "you" : "opp"} ${r.finishThisRound ? "finish" : ""}`}>
                    <div className="round-narrative-head mono">
                      ROUND {r.round}{r.finishThisRound ? " — FINISH" : ""}
                    </div>
                    <div className="round-narrative-text">{e.roundNarratives[i]}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="round-tracker">
                {e.rounds.map((r) => (
                  <div
                    key={r.round}
                    className={`round-pip ${r.playerWon ? "you" : "opp"} ${stats.finishRound === r.round ? "finish" : ""}`}
                    title={`Round ${r.round}: ${r.playerWon ? "You" : "Opponent"}${stats.finishRound === r.round ? " -- fight-ending round" : ""}`}
                  >
                    R{r.round}
                  </div>
                ))}
              </div>
            ))}
            {/* Fight moments -- standout events pulled from the whole fight
                (real danger, a knockdown, a comeback), deliberately kept
                separate from the round-by-round prose above so a non-finish
                knockdown never gets claimed as something that happened IN a
                specific round's text -- only that it happened, attributed to
                (not recorded by the sim as belonging to) the round with the
                strongest supporting evidence. */}
            {e.moments && e.moments.length > 0 && (
              <div className="fight-moments">
                {e.moments.map((m, i) => (
                  <div className={`fight-moment moment-${m.type}`} key={i}>
                    <div className="fight-moment-label mono">{m.label}{m.round ? ` · R${m.round}` : ""}</div>
                    <div className="fight-moment-text">{m.text}</div>
                  </div>
                ))}
              </div>
            )}
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
        </details>
      )}

      {/* Disclosure 2: SCOUTING / NOTES -- the pre-fight matchup read,
          narrative/context tags, and the post-fight interview quote.
          Same open/closed default as Fight Breakdown above. */}
      {hasScouting && (
        <details className="fight-detail-section" open={isMajorFight}>
          <summary>Scouting / Notes <ChevronDown size={13} className="fight-detail-chevron" /></summary>
          {e.matchup && (
            <div className={`matchup-line ${matchupWarn ? "warn" : ""}`}>
              {matchupWarn && <AlertTriangle size={12} />}
              Your {ATTR_BY_KEY[e.matchup.yourStrength.key].label} {Math.round(e.matchup.yourStrength.value)} vs their {ATTR_BY_KEY[e.matchup.oppStrength.key].label} {Math.round(e.matchup.oppStrength.value)} &mdash; {e.matchup.label}
            </div>
          )}
          {(e.rivalry || e.statement || e.bonusType || e.underdogWin || e.calledOut || visibleTraits.length > 0) && (
            <div className="fight-bottom-row">
              <div className="fight-tags">
                {e.calledOut && <div className="fight-tag rivalry">CALLED OUT</div>}
                {e.rivalry && <div className="fight-tag rivalry">RIVALRY</div>}
                {e.statement && <div className="fight-tag statement">STATEMENT WIN</div>}
                {e.bonusType === "performance" && <div className="fight-tag bonus">PERFORMANCE BONUS</div>}
                {e.bonusType === "fotn" && <div className="fight-tag bonus">FIGHT OF THE NIGHT</div>}
                {/* Betting odds are shown pre-fight now -- a real underdog win
                    (winProb < .35 at the odds the player actually saw) earns a
                    Legacy Score bump (see career.js) and, so that bonus isn't
                    invisible, this tag. */}
                {e.underdogWin && <div className="fight-tag bonus">UPSET WIN</div>}
                {visibleTraits.map((t) => (
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
        </details>
      )}
    </div>
  );
}

export default FightResultCard;
