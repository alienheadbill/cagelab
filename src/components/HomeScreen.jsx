import React, { useState, useEffect } from "react";
import { Calendar, Users, ShieldCheck, Link2, Trophy, HelpCircle, Globe, Swords, Flame as FireIcon, Sparkles, FlaskConical } from "lucide-react";
import { todayStr, decodeSeed } from "../lib/rng.js";
import { fetchDailyLeaderboard } from "../lib/supabase.js";
import { rankToTierCls } from "../lib/career.js";
import TierIcon from "./TierIcon.jsx";
import LeaderboardList from "./LeaderboardList.jsx";

function HomeScreen({ onStart, onJoinChallenge, onCollection, onCareer, onLab, hasActiveCareer, onHelp, dailyStats, preferredMode, displayName, onChangeDisplayName, profile, isFirstVisit }) {
  const [dailyNotice, setDailyNotice] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState("");
  const [showFullBoard, setShowFullBoard] = useState(false);
  const [board, setBoard] = useState([]);
  const [boardLoading, setBoardLoading] = useState(true);
  // An abandoned attempt still counts as today's attempt -- otherwise quitting
  // mid-draft and returning would give unlimited retries at the same board.
  const playedToday = dailyStats.lastCompletedDate === todayStr()
    || dailyStats.attemptedDate === todayStr();
  const completedToday = dailyStats.lastCompletedDate === todayStr();

  // The Daily leaderboard preview is the hero's payoff -- load it up front
  // instead of hiding it behind a tap, same as scores/streak.
  useEffect(() => {
    let cancelled = false;
    setBoardLoading(true);
    fetchDailyLeaderboard(todayStr(), 20).then((rows) => {
      if (!cancelled) { setBoard(rows); setBoardLoading(false); }
    });
    return () => { cancelled = true; };
  }, []);

  function handleJoin() {
    const seed = decodeSeed(joinCode);
    if (seed == null) { setJoinError("That code doesn't look right."); return; }
    setJoinError("");
    onJoinChallenge(seed);
  }

  // Welcome + Build Modes as one unit, and the Daily Challenge section
  // (name field, hero button, leaderboard) as another -- so the two can
  // trade places by visit type without duplicating either block's JSX.
  // First-time visitors need to understand what CageLab even is before
  // being pushed toward the retention hook; returning visitors already
  // know that and want Daily front and center, same as before this pass.
  const welcomeAndModes = (
    <>
      {/* First-ever visit to this browser only -- a returning player (even
          one with zero saved builds yet) never sees this again once they've
          been here once. Points at one clear starting action (Classic
          mode) without hiding anything else already on this screen. */}
      {isFirstVisit && (
        <div className="event-card good welcome-banner">
          <Sparkles size={15} />
          <div>
            Draft 10 rounds, one fighter's rating per round. At the end, CageLab reveals what you built — then you save it, test it, or take it into a Career.
            New here? <b>Classic</b> below shows every rating as you pick — the fastest way to get a feel for it.
          </div>
        </div>
      )}

      <div className="section-divider mono">BUILD MODES</div>
      <div className="mode-grid">
        <button className="mode-card compact" onClick={() => onStart("classic")}>
          <Users size={18} />
          <div className="mode-card-title">Classic</div>
          <div className="mode-card-sub">Ratings visible</div>
          {/* preferredMode defaults to "classic" before anyone has actually
              played, so gate the "Last played" claim behind isFirstVisit --
              otherwise a brand-new browser sees a false claim of history,
              right on the card the welcome banner is pointing them at. */}
          {isFirstVisit ? (
            <div className="start-tag">Start here</div>
          ) : preferredMode === "classic" && <div className="pref-tag">Last played</div>}
        </button>
        <button className="mode-card compact" onClick={() => onStart("blind")}>
          <ShieldCheck size={18} />
          <div className="mode-card-title">Blind</div>
          <div className="mode-card-sub">Trust your gut</div>
          {preferredMode === "blind" && <div className="pref-tag">Last played</div>}
        </button>
      </div>
    </>
  );

  const dailySection = (
    <>
      <div className="display-name-row">
        <input
          className="display-name-input mono"
          placeholder="DISPLAY NAME (OPTIONAL)"
          value={displayName}
          onChange={(e) => onChangeDisplayName(e.target.value.slice(0, 24))}
          maxLength={24}
          aria-label="Display name for leaderboards"
        />
      </div>

      <button className="daily-hero" onClick={() => (playedToday ? setDailyNotice((v) => !v) : onStart("daily"))}>
        <div className="daily-hero-top">
          <div className="daily-hero-eyebrow mono"><Calendar size={13} /> TODAY'S DAILY CHALLENGE</div>
          {dailyStats.currentStreak > 0 && <div className="daily-hero-streak mono"><FireIcon size={13} /> {dailyStats.currentStreak}-DAY STREAK</div>}
        </div>
        <div className="daily-hero-main">
          {completedToday ? (
            <>
              <div className="daily-hero-score">{dailyStats.lastScore}</div>
              <div className="daily-hero-status">Played today — a new board unlocks tomorrow</div>
            </>
          ) : playedToday ? (
            <>
              <div className="daily-hero-cta">USED</div>
              <div className="daily-hero-status">Today's attempt was started but not finished — a new board unlocks tomorrow</div>
            </>
          ) : (
            <>
              <div className="daily-hero-cta">PLAY NOW</div>
              <div className="daily-hero-status">The exact same board as everyone, worldwide</div>
            </>
          )}
        </div>
        <div className="daily-hero-stats">
          <div><span>Best Score</span><b>{dailyStats.bestScore}</b></div>
          <div><span>Best Streak</span><b>{dailyStats.bestStreak || dailyStats.currentStreak}</b></div>
        </div>
      </button>
      {dailyNotice && playedToday && (
        <div className="event-card" style={{ marginTop: -6 }}>
          <Calendar size={15} />
          {completedToday
            ? "You've already played today's board. Come back tomorrow for a new one!"
            : "You already started today's board. One attempt per day — come back tomorrow."}
        </div>
      )}

      <div className="leaderboard-box">
        <div className="leaderboard-title mono"><Globe size={12} /> Live Leaderboard — Today</div>
        <LeaderboardList entries={showFullBoard ? board : board.slice(0, 3)} loading={boardLoading} emptyText="No scores yet today — be the first!" />
        {board.length > 3 && (
          <button className="text-btn" onClick={() => setShowFullBoard((v) => !v)}>
            {showFullBoard ? "Show less" : `See all ${board.length}`}
          </button>
        )}
      </div>
    </>
  );

  return (
    <div className="panel home-panel">
      <div className="home-hero">
        <div className="display home-hero-title">CAGE//LAB</div>
        <div className="mono home-hero-sub">FIGHTER CONSTRUCTION LABORATORY</div>
        <div className={`tier-badge rank-badge ${rankToTierCls(profile.metaRank)}`}>
          <TierIcon cls={rankToTierCls(profile.metaRank)} size={12} /> {profile.metaRank.toUpperCase()}
        </div>
      </div>

      {(profile.totalBuilds > 0 || profile.careersCompleted > 0 || profile.dailyStreak > 0) && (
        <div className="progression-strip">
          <div className="progression-item"><div className="progression-num">{profile.bestGoat}</div><div className="progression-lbl">Best Score</div></div>
          <div className="progression-item"><div className="progression-num">{profile.dailyStreak}</div><div className="progression-lbl">Daily Streak</div></div>
          <div className="progression-item"><div className="progression-num">{profile.championships}</div><div className="progression-lbl">Championships</div></div>
          <div className="progression-item"><div className="progression-num">{profile.hofCareers}</div><div className="progression-lbl">HOF Careers</div></div>
        </div>
      )}

      {isFirstVisit ? (
        <>
          {welcomeAndModes}
          {dailySection}
        </>
      ) : (
        <>
          {dailySection}
          {welcomeAndModes}
        </>
      )}

      <div className="challenge-block">
        <div className="mode-card-title" style={{ marginBottom: 4 }}>Challenge a Friend</div>
        <div className="mode-card-sub" style={{ marginBottom: 10 }}>Same board, no respins — see who builds the better GOAT.</div>
        <button className="btn btn-ghost small-btn" onClick={() => onStart("challenge")}>
          <Link2 size={14} /> Create a Challenge Code
        </button>
        <div className="challenge-join-row">
          <input
            className="challenge-input mono"
            placeholder="ENTER CODE"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            maxLength={12}
            aria-label="Challenge code"
          />
          <button className="btn btn-primary small-btn" onClick={handleJoin}>Join</button>
        </div>
        {joinError && <div className="join-error">{joinError}</div>}
      </div>

      <div className="home-footer-row">
        <button className="btn btn-ghost small-btn" onClick={onCareer}><Swords size={14} /> {hasActiveCareer ? "Continue Career" : "Career"}</button>
        <button className="btn btn-ghost small-btn" onClick={onCollection}><Trophy size={14} /> My Legacy</button>
        <button className="btn btn-ghost small-btn" onClick={onLab}><FlaskConical size={14} /> The Lab</button>
        <button className="btn btn-ghost small-btn" onClick={onHelp}><HelpCircle size={14} /> How to Play</button>
      </div>
    </div>
  );
}

export default HomeScreen;
