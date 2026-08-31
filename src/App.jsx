import React, { useState, useRef, useEffect } from "react";
import {
  Trophy, ChevronRight, Lock, RotateCw, Shuffle, Users, MapPin, AlertTriangle,
  Crown, FastForward, Sparkles, TrendingUp, TrendingDown, Calendar, Copy,
  Moon, Sun, Home, Volume2, VolumeX, Link2, Repeat, HelpCircle,
  Target, Megaphone, Award, Globe, Loader2, Swords, BarChart3, ListOrdered, Dumbbell,
} from "lucide-react";

import "./styles.css";

import { ATTRS, ATTR_BY_KEY, WEIGHT_CLASSES, erasForClass } from "./data/attrs.js";
import { BOARD_SIZE, rosterFor, boardFor, pickCompatiblePair, pickEraWithinClass, generateOpponentNames } from "./data/fighters.js";
import { mulberry32, seedFromDateStr, todayStr, yesterdayStr, encodeSeed, shuffle } from "./lib/rng.js";
import {
  LS_PREF_MODE, LS_DAILY_STATS, LS_SAVED_BUILDS, LS_CAREER_HISTORY, LS_DARK_MODE,
  LS_SOUND_ON, LS_REDUCED_MOTION, LS_DAILY_LOG, LS_DISPLAY_NAME,
  loadJSON, saveJSON, defaultDailyStats,
} from "./lib/storage.js";
import {
  SUPABASE_ENABLED, submitDailyScore, fetchDailyLeaderboard,
  submitChallengeScore, fetchChallengeLeaderboard,
} from "./lib/supabase.js";
import { sfx } from "./lib/audio.js";
import { formatHeight, formatReach } from "./lib/utils.js";
import {
  tierOf, computeGoatScore, computeGoatScoreBreakdown, relativeHeightScore,
  relativeReachScore, relativeNoteFor, archetypeFor, synergiesFor,
  strengthsWeaknesses, buildScorecardText, matchupProfileFor,
} from "./lib/scoring.js";
import {
  DIVISION_SIZE, CLF_TIERS, rankLabel, clfTier, applyAging, resolveFight, initCareer,
  resolveCampPlanning, resolveTrainingEvent, resolveMediaEvent, prepareFight, commitFight,
  advanceCareer, fastForwardCareer, playSfxForTransition, computePlayerProfile,
  computeAchievements, ARCHETYPE_TAGLINES,
} from "./lib/career.js";

import TierIcon from "./components/TierIcon.jsx";
import CopyScorecardButton from "./components/CopyScorecardButton.jsx";
import ShareCardCanvas from "./components/ShareCardCanvas.jsx";
import RadarChart from "./components/RadarChart.jsx";
import AnimatedGoatScore from "./components/AnimatedGoatScore.jsx";
import AttributeBarList from "./components/AttributeBarList.jsx";
import TapeCard from "./components/TapeCard.jsx";
import FighterPickCard from "./components/FighterPickCard.jsx";
import FightResultCard from "./components/FightResultCard.jsx";
import DivisionRollPanel from "./components/DivisionRollPanel.jsx";
import CareerSetupPanel from "./components/CareerSetupPanel.jsx";
import CampPlanningPanel from "./components/CampPlanningPanel.jsx";
import LeaderboardList from "./components/LeaderboardList.jsx";
import HomeScreen from "./components/HomeScreen.jsx";
import HelpScreen from "./components/HelpScreen.jsx";
import CollectionScreen from "./components/CollectionScreen.jsx";

export default function CageLab() {
  const [phase, setPhase] = useState("home");
  const [mode, setMode] = useState("classic"); // classic | blind | daily | challenge
  const [fighterName, setFighterName] = useState("");
  const [attributeOrder, setAttributeOrder] = useState(() => shuffle(ATTRS.map((a) => a.key)));
  const [round, setRound] = useState(1);
  const [pair, setPair] = useState(() => pickCompatiblePair());
  const [board, setBoard] = useState([]);
  const [lockedDivision, setLockedDivision] = useState(null);
  const [respinsUsed, setRespinsUsed] = useState({ era: false, stat: false });
  const [picks, setPicks] = useState({});
  const [careerState, setCareerState] = useState(null);
  // Bottom tab nav, career mode only. "career" is the default hub/next-fight
  // view; camp planning specifically lives under "camp" (see the auto-switch
  // effect below), rather than sharing the hub with fight-related decisions.
  const [careerTab, setCareerTab] = useState("career");
  // The fight that was just committed stays "spotlighted" at the top of the
  // Career tab (right where the pre-fight screen was) instead of dropping
  // straight into the bottom of the ever-growing history feed -- otherwise
  // every single fight meant scrolling all the way down to read the result,
  // then all the way back up to keep going. It settles into the normal
  // history list (and stops being spotlighted) the moment the player moves
  // on, same tap as advancing the career.
  const [spotlightFightId, setSpotlightFightId] = useState(null);
  const [goatScore, setGoatScore] = useState(null);
  const [statOrderOverride, setStatOrderOverride] = useState(null);
  const [buildSaved, setBuildSaved] = useState(false);
  const [showShareBlock, setShowShareBlock] = useState(false);
  const [darkMode, setDarkMode] = useState(() => loadJSON(LS_DARK_MODE, false));
  const [soundOn, setSoundOn] = useState(() => loadJSON(LS_SOUND_ON, false));
  const [reducedMotion, setReducedMotion] = useState(() => loadJSON(LS_REDUCED_MOTION, false));
  const [displayName, setDisplayName] = useState(() => loadJSON(LS_DISPLAY_NAME, ""));
  const [challengeBoard, setChallengeBoard] = useState([]);
  const [challengeBoardLoading, setChallengeBoardLoading] = useState(false);
  const [dailyResultBoard, setDailyResultBoard] = useState([]);
  const [dailyResultLoading, setDailyResultLoading] = useState(false);
  const [challengeSeed, setChallengeSeed] = useState(null);
  const [whatIf, setWhatIf] = useState(null);
  const [pickedFighterId, setPickedFighterId] = useState(null);
  const [isRolling, setIsRolling] = useState(false);
  const [rollPreview, setRollPreview] = useState(null);
  const rollTimeoutRef = useRef(null);
  const pickTimeoutRef = useRef(null);
  const dailyRngRef = useRef(null);

  useEffect(() => {
    if (phase === "draftDone" && mode === "challenge" && challengeSeed != null) {
      let cancelled = false;
      setChallengeBoardLoading(true);
      fetchChallengeLeaderboard(encodeSeed(challengeSeed), 20).then((rows) => {
        if (!cancelled) { setChallengeBoard(rows); setChallengeBoardLoading(false); }
      });
      return () => { cancelled = true; };
    }
  }, [phase, mode, challengeSeed]);

  useEffect(() => {
    if (phase === "draftDone" && mode === "daily") {
      let cancelled = false;
      setDailyResultLoading(true);
      // Pull the full day's field (up to 200) so rank/average are computed
      // from real data, not just the top-20 shown in the leaderboard widget.
      fetchDailyLeaderboard(todayStr(), 200).then((rows) => {
        if (!cancelled) { setDailyResultBoard(rows); setDailyResultLoading(false); }
      });
      return () => { cancelled = true; };
    }
  }, [phase, mode]);

  // Auto-switch to whichever tab a newly-pending decision actually lives on,
  // so it's never missed just because the player was parked on Rankings or
  // Stats -- camp planning has its own tab (with a badge as backup below),
  // everything else surfaces on the main Career hub.
  useEffect(() => {
    if (!careerState || !careerState.pendingDecision) return;
    setCareerTab(careerState.pendingDecision.type === "campPlanning" ? "camp" : "career");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [careerState && careerState.pendingDecision && careerState.pendingDecision.type, careerState && careerState.timeline.length]);

  const order = statOrderOverride || attributeOrder;
  const currentAttrKey = order[round - 1];
  const currentAttr = ATTR_BY_KEY[currentAttrKey];
  // The visible board is stored in state, NOT derived inline -- deriving it
  // would redraw a different random five on every render (including every
  // hover/animation tick), so fighters would change while you're reading them.
  const roster = board.length ? board : rosterFor(pair.wc, pair.era).slice(0, BOARD_SIZE);
  const name = fighterName.trim() || "The Prospect";
  const blind = mode === "blind";
  const isSeeded = mode === "daily" || mode === "challenge";
  const dailyStats = loadJSON(LS_DAILY_STATS, defaultDailyStats);
  const preferredMode = loadJSON(LS_PREF_MODE, "classic");

  function goHome() { setPhase("home"); }
  function toggleDark() { setDarkMode((v) => { const n = !v; saveJSON(LS_DARK_MODE, n); return n; }); }
  function toggleSound() { setSoundOn((v) => { const n = !v; saveJSON(LS_SOUND_ON, n); if (n) sfx("select"); return n; }); }
  function toggleReducedMotion() { setReducedMotion((v) => { const n = !v; saveJSON(LS_REDUCED_MOTION, n); return n; }); }

  // Always set the pair and its visible board together -- if these ever drift
  // apart you'd be looking at fighters from a different era/division than the
  // header claims.
  function applyPair(nextPair, rng = Math.random) {
    setPair(nextPair);
    setBoard(boardFor(nextPair.wc, nextPair.era, rng));
  }

  function startDraft(selectedMode, explicitSeed) {
    clearTimeout(pickTimeoutRef.current);
    clearTimeout(rollTimeoutRef.current);
    setPickedFighterId(null);
    setIsRolling(false);
    setRollPreview(null);
    let seededDivision = null;
    if (selectedMode === "daily") {
      dailyRngRef.current = mulberry32(seedFromDateStr(todayStr()));
      setAttributeOrder(shuffle(ATTRS.map((a) => a.key), dailyRngRef.current));
      // Seeded modes roll the division from the seed so everyone gets the
      // same division as well as the same boards.
      seededDivision = WEIGHT_CLASSES[Math.floor(dailyRngRef.current() * WEIGHT_CLASSES.length)];
      applyPair(pickEraWithinClass(seededDivision, dailyRngRef.current), dailyRngRef.current);
      setChallengeSeed(null);
      // Consume the daily attempt the moment the draft STARTS, not when it
      // finishes. Previously the lock was only written on completion, so
      // quitting mid-draft and returning gave you unlimited retries at the
      // same board. `attemptedDate` marks the attempt; `lastCompletedDate`
      // still only updates on a real finish, so streaks stay honest.
      const stats = loadJSON(LS_DAILY_STATS, defaultDailyStats);
      saveJSON(LS_DAILY_STATS, { ...stats, attemptedDate: todayStr() });
    } else if (selectedMode === "challenge") {
      const seed = explicitSeed != null ? explicitSeed : Math.floor(Math.random() * 1e9);
      dailyRngRef.current = mulberry32(seed);
      setChallengeSeed(seed);
      setAttributeOrder(shuffle(ATTRS.map((a) => a.key), dailyRngRef.current));
      seededDivision = WEIGHT_CLASSES[Math.floor(dailyRngRef.current() * WEIGHT_CLASSES.length)];
      applyPair(pickEraWithinClass(seededDivision, dailyRngRef.current), dailyRngRef.current);
    } else {
      dailyRngRef.current = null;
      setChallengeSeed(null);
      setAttributeOrder(shuffle(ATTRS.map((a) => a.key)));
      saveJSON(LS_PREF_MODE, selectedMode);
    }
    setMode(selectedMode);
    setRound(1);
    setPicks({});
    setLockedDivision(seededDivision);
    setRespinsUsed({ era: false, stat: false });
    setStatOrderOverride(null);
    setFighterName("");
    setGoatScore(null);
    setBuildSaved(false);
    setShowShareBlock(false);
    setWhatIf(null);
    setPhase(seededDivision ? "draft" : "divisionSelect");
  }

  // Free play only -- locks the chosen division and begins the draft.
  function handleDivisionSelect(wc) {
    sfx("select");
    setLockedDivision(wc);
    applyPair(pickEraWithinClass(wc));
    setPhase("draft");
  }

  // Cycles the attribute/era/weight badges through random values a handful of
  // times with increasing delays (slot-machine deceleration), then lands on
  // the real next round. Uses plain Math.random for the cosmetic flicker only
  // -- the actual next pair still comes from the seeded rng in Daily/Challenge,
  // so determinism is untouched.
  function startRoundRoll(nextRound, division) {
    // `division` is passed explicitly from handlePick because setLockedDivision
    // won't have flushed yet when this runs -- reading lockedDivision here
    // would use the previous round's (null) value on the round 1 -> 2 transition.
    const lock = division !== undefined ? division : lockedDivision;
    const nextPair = (rng) => (lock ? pickEraWithinClass(lock, rng) : pickCompatiblePair(undefined, rng));

    if (reducedMotion) {
      const rng = isSeeded && dailyRngRef.current ? dailyRngRef.current : Math.random;
      applyPair(nextPair(rng), rng);
      setRound(nextRound);
      return;
    }
    setIsRolling(true);
    const delays = [55, 60, 70, 85, 100, 125, 155, 195, 245, 300];
    let i = 0;
    const tick = () => {
      setRollPreview({
        attrKey: ATTRS[Math.floor(Math.random() * ATTRS.length)].key,
        // Once the division is locked, don't flicker through other weight
        // classes -- that would imply they're still in play.
        wc: lock || WEIGHT_CLASSES[Math.floor(Math.random() * WEIGHT_CLASSES.length)],
        era: ["2000s", "2010s", "2020s"][Math.floor(Math.random() * 3)],
      });
      if (i < delays.length - 1) {
        i += 1;
        rollTimeoutRef.current = setTimeout(tick, delays[i]);
      } else {
        const rng = isSeeded && dailyRngRef.current ? dailyRngRef.current : Math.random;
        applyPair(nextPair(rng), rng);
        setRound(nextRound);
        setIsRolling(false);
        setRollPreview(null);
        sfx("whoosh");
      }
    };
    tick();
  }

  function valueFor(fighter, attrKey) {
    const attr = ATTR_BY_KEY[attrKey];
    if (attr.kind === "height") {
      const scoreValue = relativeHeightScore(fighter.ht, fighter.wc);
      return { fighter: fighter.n, raw: fighter.ht, display: formatHeight(fighter.ht), scoreValue, relativeNote: relativeNoteFor("height", scoreValue) };
    }
    if (attr.kind === "reach") {
      const scoreValue = relativeReachScore(fighter.rc, fighter.wc);
      return { fighter: fighter.n, raw: fighter.rc, display: formatReach(fighter.rc), scoreValue, relativeNote: relativeNoteFor("reach", scoreValue) };
    }
    const rating = fighter[attrKey];
    return { fighter: fighter.n, raw: rating, display: String(rating), scoreValue: rating };
  }

  function recordDailyCompletion(score) {
    const today = todayStr();
    const stats = loadJSON(LS_DAILY_STATS, defaultDailyStats);
    let streak = stats.currentStreak;
    if (stats.lastCompletedDate === yesterdayStr()) streak += 1;
    else if (stats.lastCompletedDate !== today) streak = 1;
    const bestStreak = Math.max(stats.bestStreak || 0, streak);
    saveJSON(LS_DAILY_STATS, { bestScore: Math.max(stats.bestScore, score), currentStreak: streak, bestStreak, lastCompletedDate: today, lastScore: score });
    const log = loadJSON(LS_DAILY_LOG, []);
    saveJSON(LS_DAILY_LOG, [{ date: today, score }, ...log].slice(0, 60));
    // Fire-and-forget: local stats above already saved regardless of network/backend status.
    submitDailyScore(today, score, loadJSON(LS_DISPLAY_NAME, ""));
  }

  function handlePick(fighter) {
    if (pickedFighterId || isRolling) return; // ignore taps mid-animation
    sfx("select");
    setPickedFighterId(fighter.id);
    const value = valueFor(fighter, currentAttrKey);
    const nextPicks = { ...picks, [currentAttrKey]: value };
    const isFinalRound = round >= ATTRS.length;

    pickTimeoutRef.current = setTimeout(() => {
      setPicks(nextPicks);
      setPickedFighterId(null);

      if (isFinalRound) {
        const score = computeGoatScore(nextPicks);
        setGoatScore(score);
        // A blank name would otherwise carry the placeholder "The Prospect"
        // through the whole career -- auto-generate a real one from the same
        // pool that names every NPC, so a skipped field still feels like a
        // fighter rather than a stand-in.
        if (!fighterName.trim()) setFighterName(generateOpponentNames(1)[0]);
        if (mode === "daily") recordDailyCompletion(score);
        if (mode === "challenge" && challengeSeed != null) {
          submitChallengeScore(encodeSeed(challengeSeed), score, loadJSON(LS_DISPLAY_NAME, ""));
        }
        setPhase("draftDone");
      } else {
        startRoundRoll(round + 1, lockedDivision);
      }
    }, reducedMotion ? 0 : 300);
  }

  function respinEra() {
    if (respinsUsed.era || isSeeded) return;
    const eras = erasForClass(pair.wc).filter((e) => e !== pair.era);
    if (!eras.length) return; // nothing to switch to
    sfx("select");
    setRespinsUsed((r) => ({ ...r, era: true }));
    // Must go through applyPair, not setPair -- setPair alone changes the era
    // label but leaves the old five fighters on the board, which reads as the
    // respin having done nothing.
    applyPair({ wc: pair.wc, era: eras[Math.floor(Math.random() * eras.length)] });
  }
  function respinStat() {
    if (respinsUsed.stat || round >= ATTRS.length || isSeeded) return;
    sfx("select");
    setRespinsUsed((r) => ({ ...r, stat: true }));
    setStatOrderOverride((prev) => {
      const base = prev || attributeOrder;
      const idx = round - 1;
      const futureIdxs = base.map((_, i) => i).filter((i) => i > idx);
      const swapWith = futureIdxs[Math.floor(Math.random() * futureIdxs.length)];
      const next = [...base];
      [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
      return next;
    });
  }


  function saveCurrentBuild() {
    sfx("select");
    const builds = loadJSON(LS_SAVED_BUILDS, []);
    const entry = {
      id: Date.now().toString(36),
      savedAt: new Date().toISOString(),
      fighterName: name,
      mode,
      goatScore,
      picks: ATTRS.map((a) => ({ key: a.key, label: a.label, fighter: picks[a.key].fighter, display: picks[a.key].display, scoreValue: picks[a.key].scoreValue })),
    };
    saveJSON(LS_SAVED_BUILDS, [entry, ...builds].slice(0, 20));
    setBuildSaved(true);
  }

  // Reconstructs a saved build's `picks` shape from its flat stored array and
  // drops the player onto the build-complete screen -- ready to re-copy the
  // scorecard, re-save, or immediately Start Career with that exact build.
  function loadSavedBuild(build) {
    sfx("select");
    const restoredPicks = {};
    (build.picks || []).forEach((p) => {
      restoredPicks[p.key] = { fighter: p.fighter, display: p.display, scoreValue: p.scoreValue };
    });
    setPicks(restoredPicks);
    setFighterName(build.fighterName || "");
    setMode(build.mode || "classic");
    setGoatScore(build.goatScore);
    setBuildSaved(true);
    setShowShareBlock(false);
    setChallengeSeed(null);
    setWhatIf(null);
    // Deliberately NOT clearing careerState here. "Load into Career" is
    // reachable from Trophy Case at any time, including with a career
    // already in progress -- nulling it out unconditionally silently
    // discarded the active career (and, as a side effect, reopened its
    // locked height/reach sliders once the player reached Career Setup
    // with no career on record to protect). Leaving an active career's
    // state alone here means beginCareer()'s existing guard below still
    // sees it and routes back to resuming it instead of launching a new
    // one for whatever build was just loaded.
    setRound(ATTRS.length);
    setPhase("draftDone");
  }

  function saveCareerToHistory(result) {
    const history = loadJSON(LS_CAREER_HISTORY, []);
    const entry = {
      id: Date.now().toString(36), savedAt: new Date().toISOString(),
      fighterName: name, record: result.record, verdict: result.verdict,
      legacyScore: result.legacyScore, titleReigns: result.titleReigns,
      titleDefenses: result.titleDefenses, rivalryWins: result.rivalryWins,
      statementWins: result.statementWins, longestStreak: result.longestStreak,
      totalFightCount: result.totalFightCount, wonTitleAsUnderdog: result.wonTitleAsUnderdog,
    };
    saveJSON(LS_CAREER_HISTORY, [entry, ...history].slice(0, 10));
  }

  // "Start Career" routes through the setup screen rather than launching
  // straight in -- division, physicals, era and style all get chosen there.
  // Reachable from the draftDone screen even while a career is already
  // running (draft a fresh build from Home without leaving the active
  // career) -- same guard as Home's Career button, for the same reason:
  // launching from setup always calls initCareer() fresh and would
  // silently overwrite the in-progress one.
  function beginCareer() {
    setPhase(careerState && !careerState.finished ? "sim" : "careerSetup");
  }

  function launchCareer(opts) {
    sfx("select");
    setPicks(opts.picks);
    setFighterName(opts.name);
    setCareerState(initCareer(opts.picks, {
      division: opts.division,
      debutEra: opts.debutEra,
      careerStyle: opts.careerStyle,
      actualHeight: opts.actualHeight,
      actualReach: opts.actualReach,
    }));
    setWhatIf(null);
    setCareerTab("career");
    // A brand-new career's fight ids restart from f-1, so a spotlight left
    // over from a previous career could otherwise collide with (and wrongly
    // hide) an unrelated fight here.
    setSpotlightFightId(null);
    setPhase("sim");
  }

  function handleAdvance() {
    // Whatever was spotlighted has been seen -- let it settle into the
    // normal history feed as we move on to whatever's next.
    setSpotlightFightId(null);
    const next = advanceCareer(careerState);
    playSfxForTransition(careerState, next);
    setCareerState(next);
    if (next.finished && !careerState.finished) saveCareerToHistory(next);
  }
  function handleCampConfirm(choice) {
    sfx("select");
    setCareerState(resolveCampPlanning(careerState, choice));
    // Camp planning has its own tab so it doesn't compete with fight-related
    // decisions for the same panel, but once it's resolved there's nothing
    // left to do there -- send the player back to the main hub instead of
    // leaving them stranded on a now-idle Camp tab.
    setCareerTab("career");
  }
  function handleFightChoice(tag) {
    // Picking a booking type no longer resolves the fight on the spot --
    // it sets up the opponent/odds and hands off to the pre-fight screen
    // (pendingDecision "preFight"), same as a default booking does. Nothing
    // has actually happened yet, so no transition sfx or history save here;
    // that's handleCommitFight's job once the player confirms.
    sfx("select");
    setCareerState(prepareFight(careerState, tag));
  }
  function handleCommitFight() {
    const next = commitFight(careerState);
    playSfxForTransition(careerState, next);
    setCareerState(next);
    // Spotlight the fight that just happened -- commitFight always appends
    // exactly one "fight" timeline entry, so the last entry is it.
    const lastEntry = next.timeline[next.timeline.length - 1];
    if (lastEntry && lastEntry.type === "fight") setSpotlightFightId(lastEntry.id);
    if (next.finished && !careerState.finished) saveCareerToHistory(next);
  }
  function handleTrainingEvent(addressed) {
    sfx("select");
    setCareerState(resolveTrainingEvent(careerState, careerState.pendingDecision.attr, addressed));
  }
  function handleMediaEvent(fireBack) {
    sfx("select");
    setCareerState(resolveMediaEvent(careerState, fireBack));
  }
  function handleFastForward() {
    setSpotlightFightId(null);
    const next = fastForwardCareer(careerState);
    sfx("whoosh");
    setCareerState(next);
    if (next.finished && !careerState.finished) saveCareerToHistory(next);
  }
  function replayDefiningLoss() {
    const snap = careerState.definingLoss && careerState.definingLoss.fightSnapshot;
    if (!snap) return;
    sfx("select");
    // snap.totalRounds falls back to 3 for a snapshot saved before this
    // field existed (an in-progress career already in someone's browser).
    const result = resolveFight(snap.effective, snap.reachScore, snap.oppAttrs, snap.stanceBias, snap.playerTraits, snap.oppTraits, snap.totalRounds || 3);
    sfx(result.win ? "win" : "loss");
    setWhatIf({ ...result, oppName: careerState.definingLoss.oppName });
  }
  function runItBack() {
    setCareerState(initCareer(picks));
    setWhatIf(null);
    setPhase("sim");
  }

  const goatTier = goatScore !== null ? (goatScore >= 90 ? "tier-legend" : goatScore >= 75 ? "tier-gold" : goatScore >= 55 ? "tier-silver" : "tier-bronze") : null;

  const dailyRankInfo = (() => {
    if (mode !== "daily" || goatScore === null) return null;
    if (dailyResultLoading) return { loading: true };
    if (!SUPABASE_ENABLED || dailyResultBoard.length === 0) return { unavailable: true };
    const better = dailyResultBoard.filter((r) => r.score > goatScore).length;
    const avg = Math.round(dailyResultBoard.reduce((s, r) => s + r.score, 0) / dailyResultBoard.length);
    const percentile = Math.round((1 - better / dailyResultBoard.length) * 100);
    return { rank: better + 1, field: dailyResultBoard.length, avg, percentile };
  })();
  const modeChipLabel = mode === "daily" ? "DAILY" : mode === "challenge" ? "CHALLENGE" : mode === "blind" ? "BLIND" : "CLASSIC";
  const displayAttr = isRolling && rollPreview ? ATTR_BY_KEY[rollPreview.attrKey] : currentAttr;

  const estimatedTotalFights = careerState ? careerState.totalYears * 3 : 1;
  const fightsCompleted = careerState ? careerState.record.w + careerState.record.l : 0;
  const progressDenominator = careerState && careerState.finished ? Math.max(1, careerState.totalFightCount) : estimatedTotalFights;
  const progressPct = careerState ? Math.min(100, Math.round((fightsCompleted / progressDenominator) * 100)) : 0;

  // The champion is whoever is flagged isChampion -- never the fighter that
  // happens to sit at array position 0. When the player holds the belt,
  // nobody in the roster is flagged and this is null (the player's own
  // "C" row covers it). The ranked pool is the top 15 non-champion
  // fighters, so the numbering shifts correctly whether or not a division
  // member currently holds the title.
  const divisionChampion = careerState && careerState.divisionRoster
    ? careerState.divisionRoster.find((f) => f.isChampion)
    : null;
  const rankedPool = careerState && careerState.divisionRoster
    ? careerState.divisionRoster.filter((f) => !f.isChampion).slice(0, DIVISION_SIZE)
    : [];

  // Purely presentational: maps a circuit tier name onto its rung on the CLF
  // ladder (CLF_TIERS is already ordered Regional -> National -> Contender
  // Series -> PREMIER) so the tier-color ramp in CSS can step from muted to
  // full gold as the tier climbs, instead of every tier looking the same.
  const tierRampCls = (tierName) => `tier-ramp-${Math.max(0, CLF_TIERS.findIndex((t) => t.name === tierName))}`;

  // Last few results at a glance, oldest-to-newest so the strip reads like a
  // trend -- part of the decision-first career hub, so "how am I doing"
  // doesn't require scrolling the full history.
  const recentForm = careerState
    ? careerState.timeline.filter((e) => e.type === "fight").slice(-5)
    : [];

  // Idle-state view for the Camp tab: the last plan made, so the tab isn't
  // just blank between camps.
  const lastCampPlan = careerState
    ? [...careerState.timeline].reverse().find((e) => e.type === "campPlan")
    : null;

  return (
    <div className={`app-root ${darkMode ? "dark" : ""} ${reducedMotion ? "reduced-motion" : ""}`}>

      <div className="header-wrap">
        <div className="header-top-row">
          <div>
            <div className="brand display">CAGE<span>//</span>LAB</div>
            <div className="tagline mono">{ATTRS.length} rounds &middot; real fighters &middot; build a legacy</div>
          </div>
          <div className="top-icons">
            <button className={`icon-btn ${soundOn ? "active-toggle" : ""}`} onClick={toggleSound} aria-label={soundOn ? "Mute sound" : "Enable sound"}>
              {soundOn ? <Volume2 size={15} /> : <VolumeX size={15} />}
            </button>
            <button className="icon-btn" onClick={toggleDark} aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}>
              {darkMode ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            {phase !== "home" && <button className="icon-btn" onClick={goHome} aria-label="Home"><Home size={15} /></button>}
            <button className="icon-btn" onClick={() => setPhase("help")} aria-label="How to play"><HelpCircle size={15} /></button>
          </div>
        </div>
        <div className="brass-rule" />
      </div>

      {phase === "home" && (
        <HomeScreen
          onStart={startDraft}
          onJoinChallenge={(seed) => startDraft("challenge", seed)}
          onCollection={() => setPhase("collection")}
          // A career already in progress resumes straight into it instead of
          // re-entering Career Setup -- that screen's height/reach sliders
          // are for creating a NEW career, and launching from there always
          // calls initCareer() fresh, which would silently overwrite (and
          // lose) whatever career is already running.
          onCareer={() => setPhase(careerState && !careerState.finished ? "sim" : "careerSetup")}
          hasActiveCareer={!!(careerState && !careerState.finished)}
          onHelp={() => setPhase("help")}
          dailyStats={dailyStats}
          preferredMode={preferredMode}
          displayName={displayName}
          onChangeDisplayName={(v) => { setDisplayName(v); saveJSON(LS_DISPLAY_NAME, v); }}
          profile={computePlayerProfile({ dailyStats, savedBuilds: loadJSON(LS_SAVED_BUILDS, []), careerHistory: loadJSON(LS_CAREER_HISTORY, []) })}
        />
      )}

      {phase === "help" && <HelpScreen onBack={goHome} />}

      {phase === "collection" && (
        <CollectionScreen
          onBack={goHome}
          dailyStats={dailyStats}
          savedBuilds={loadJSON(LS_SAVED_BUILDS, [])}
          careerHistory={loadJSON(LS_CAREER_HISTORY, [])}
          dailyLog={loadJSON(LS_DAILY_LOG, [])}
          achievements={computeAchievements({ dailyStats, savedBuilds: loadJSON(LS_SAVED_BUILDS, []), careerHistory: loadJSON(LS_CAREER_HISTORY, []) })}
          reducedMotion={reducedMotion}
          onToggleReducedMotion={toggleReducedMotion}
          onLoadBuild={loadSavedBuild}
          onClearBuilds={() => { saveJSON(LS_SAVED_BUILDS, []); setPhase("home"); setTimeout(() => setPhase("collection"), 0); }}
          onClearCareers={() => { saveJSON(LS_CAREER_HISTORY, []); setPhase("home"); setTimeout(() => setPhase("collection"), 0); }}
          onImportFile={() => { setPhase("home"); setTimeout(() => setPhase("collection"), 0); }}
        />
      )}

      {phase === "careerSetup" && (
        <CareerSetupPanel
          savedBuilds={loadJSON(LS_SAVED_BUILDS, [])}
          currentPicks={Object.keys(picks).length === ATTRS.length ? picks : null}
          currentName={name}
          onLaunch={launchCareer}
          onBack={() => setPhase(goatScore !== null ? "draftDone" : "home")}
        />
      )}

      {phase === "divisionSelect" && (
        <DivisionRollPanel onSettled={handleDivisionSelect} reducedMotion={reducedMotion} />
      )}

      {phase === "draft" && (
        <div className="draft-flex">
          <div className="draft-left">
            <TapeCard
              name={name}
              picks={picks}
              blind={blind}
              modeChip={modeChipLabel}
              lastPickedKey={round > 1 ? order[round - 2] : null}
              compact
              editableName={round === 1 && Object.keys(picks).length === 0}
              nameValue={fighterName}
              onChangeName={setFighterName}
            />
          </div>

          <div className="draft-right">
            <div className="panel draft-round-panel">
              <div className="round-attr-row">
                <div className={`attr-badge ${isRolling ? "rolling" : ""}`}>
                  <div className="attr-icon"><displayAttr.icon size={16} /></div>
                  <div className="attr-name">{displayAttr.label}</div>
                </div>
                <div className="round-lbl">{isRolling ? "Rolling…" : `Round ${round}/${ATTRS.length}`}</div>
              </div>

              <div className="context-row">
                <div className={`context-chip ${isRolling ? "rolling" : ""}`}><MapPin size={12} /> {isRolling && rollPreview ? rollPreview.era : pair.era}</div>
                <div className={`context-chip ${isRolling ? "rolling" : ""} ${lockedDivision ? "locked" : ""}`}>
                  {lockedDivision ? <Lock size={12} /> : <Users size={12} />}
                  {isRolling && rollPreview ? rollPreview.wc : pair.wc}
                </div>
              </div>

              {!isRolling && lockedDivision && (
                <div className="daily-note division-note">
                  <Lock size={12} /> <b>{lockedDivision}</b> — every round drafts from this division. Era rotates each round.
                </div>
              )}
              {mode === "daily" && !isRolling && (
                <div className="daily-note"><Calendar size={12} /> Daily Challenge — same board for everyone, no respins.</div>
              )}
              {mode === "challenge" && !isRolling && (
                <div className="daily-note">
                  <Link2 size={12} /> Challenge Code: <span className="code-pill">{encodeSeed(challengeSeed)}</span> — share it, no respins.
                </div>
              )}
              {!isSeeded && !isRolling && (
                <div className="respin-row">
                  <button className="respin-btn" onClick={respinEra} disabled={respinsUsed.era} title="Reroll era (once per build)">
                    <Shuffle size={12} /> Era
                  </button>
                  <button className="respin-btn" onClick={respinStat} disabled={respinsUsed.stat || round >= ATTRS.length} title="Reroll this attribute (once per build)">
                    <Shuffle size={12} /> Stat
                  </button>
                </div>
              )}

              {isRolling ? (
                <div className="rolling-box">
                  <RotateCw size={26} className="spin-icon" />
                  <div className="rolling-label mono">Locking in next round&hellip;</div>
                </div>
              ) : (
                <div className="pick-card-grid">
                  {roster.map((f, i) => (
                    <FighterPickCard
                      key={f.id}
                      fighter={f}
                      index={i}
                      currentAttrKey={currentAttrKey}
                      blind={blind}
                      value={valueFor(f, currentAttrKey)}
                      selected={pickedFighterId === f.id}
                      disabled={pickedFighterId != null}
                      onPick={() => handlePick(f)}
                    />
                  ))}
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {phase === "draftDone" && goatScore !== null && (
        <>
          <div className="panel result-hero-panel">
            <div className="result-eyebrow mono">YOUR FIGHTER</div>
            <div className="result-fighter-name display">{name}</div>
            <div className="result-goat-num display"><AnimatedGoatScore score={goatScore} reducedMotion={reducedMotion} /></div>
            <div className="result-goat-lbl mono">GOAT SCORE</div>
            <div className={`tier-badge result-tier-badge ${goatTier} reveal-stagger reveal-delay-1`}>
              <TierIcon cls={goatTier} size={13} />
              {goatTier === "tier-legend" ? "LEGENDARY BUILD" : goatTier === "tier-gold" ? "ELITE BUILD" : goatTier === "tier-silver" ? "SOLID BUILD" : "ROUGH BUILD"}
            </div>

            <div className="result-identity reveal-stagger reveal-delay-2">
              <div className="result-archetype-name display">THE {archetypeFor(picks).toUpperCase()}</div>
              <div className="result-archetype-tagline">{ARCHETYPE_TAGLINES[archetypeFor(picks)] || ""}</div>
              <div className="result-weapon-row">
                <div><span>Primary Weapon</span><b>{strengthsWeaknesses(picks).strengths[0].label}</b></div>
                <div><span>Secondary Weapon</span><b>{strengthsWeaknesses(picks).strengths[1].label}</b></div>
                <div><span>Liability</span><b className="bad-text">{strengthsWeaknesses(picks).weaknesses[0].label}</b></div>
              </div>
            </div>
          </div>

          <div className="panel reveal-stagger reveal-delay-3">
            <div className="section-label">Attribute Radar</div>
            <RadarChart picks={picks} />
            <div className="radar-legend">
              <span><span className="radar-swatch build" /> Your Build</span>
              <span><span className="radar-swatch benchmark" /> Elite (85)</span>
            </div>
          </div>

          <div className="panel reveal-stagger reveal-delay-4">
            <div className="section-label">Full Attribute Breakdown</div>
            <AttributeBarList picks={picks} />

            {synergiesFor(picks).length > 0 && (
              <div className="synergy-block">
                <div className="decision-group-label" style={{ margin: "14px 0 6px" }}>Synergies</div>
                {synergiesFor(picks).map((s) => (
                  <div className="synergy-chip" key={s.label}>
                    <Sparkles size={12} /> <b>{s.label}</b> &mdash; {s.desc}
                  </div>
                ))}
              </div>
            )}

            <details className="score-breakdown-details">
              <summary>How was this score calculated?</summary>
              <div className="score-breakdown">
                {(() => {
                  const bd = computeGoatScoreBreakdown(picks);
                  return (
                    <>
                      <div className="breakdown-row"><span>Base Score</span><b>{bd.base}</b></div>
                      <div className="breakdown-row"><span>Elite Bonus (90+ ratings)</span><b>{bd.elite >= 0 ? "+" : ""}{bd.elite}</b></div>
                      <div className="breakdown-row"><span>Balance Bonus (spread {bd.spread})</span><b>{bd.balance >= 0 ? "+" : ""}{bd.balance}</b></div>
                      <div className="breakdown-row bad-text"><span>Weak Stat Penalty</span><b>-{bd.weak}</b></div>
                      <div className="breakdown-row breakdown-final"><span>Final Score</span><b>{bd.final}</b></div>
                    </>
                  );
                })()}
              </div>
            </details>
          </div>

          <div className="panel reveal-stagger reveal-delay-5">
            <div className="section-label">Matchup Profile <span className="section-label-sub">Scouting Report</span></div>
            <div className="scouting-report">
              {matchupProfileFor(picks).map((m) => (
                <div className="scout-row" key={m.name}>
                  <div className="scout-row-top">
                    <span className="scout-opp-name">{m.name}s</span>
                    <span className={`scout-verdict scout-${m.label.toLowerCase().replace(" ", "-")}`}>{m.label}</span>
                  </div>
                  <div className="scout-winpct mono">{m.winPct}% win probability</div>
                  <div className="scout-why">{m.explanation}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            {mode === "daily" && (
              <div className="daily-result-box">
                <div className="leaderboard-title mono"><Globe size={12} /> Today's Result</div>
                {dailyRankInfo && dailyRankInfo.loading && (
                  <div className="leaderboard-status mono"><Loader2 size={13} className="spin-icon" /> Calculating rank&hellip;</div>
                )}
                {dailyRankInfo && dailyRankInfo.unavailable && (
                  <div className="leaderboard-status mono">Rank unavailable right now — leaderboard couldn't be reached.</div>
                )}
                {dailyRankInfo && dailyRankInfo.rank && (
                  <div className="daily-result-grid">
                    <div><span>Your Score</span><b>{goatScore}</b></div>
                    <div><span>Your Rank</span><b>#{dailyRankInfo.rank} <span className="mono" style={{ fontWeight: 400, fontSize: 10 }}>of {dailyRankInfo.field}</span></b></div>
                    <div><span>Percentile</span><b>Top {100 - dailyRankInfo.percentile < 1 ? "1" : 100 - dailyRankInfo.percentile}%</b></div>
                    <div><span>Best Score</span><b>{dailyStats.bestScore}</b></div>
                    <div><span>Field Average</span><b>{dailyRankInfo.avg}</b></div>
                  </div>
                )}
                <div className="daily-result-grid" style={{ marginTop: 8 }}>
                  <div><span>Current Streak</span><b>{dailyStats.currentStreak}</b></div>
                  <div><span>Best Streak</span><b>{dailyStats.bestStreak || dailyStats.currentStreak}</b></div>
                </div>
              </div>
            )}

            {mode === "challenge" && (
              <>
                <div className="daily-note" style={{ justifyContent: "center" }}>
                  <Link2 size={12} /> Your code: <span className="code-pill">{encodeSeed(challengeSeed)}</span>
                </div>
                <div className="leaderboard-box">
                  <div className="leaderboard-title mono"><Globe size={12} /> Leaderboard for this code</div>
                  <LeaderboardList entries={challengeBoard} loading={challengeBoardLoading} emptyText="You're first on this board — share the code!" />
                </div>
              </>
            )}

            <div className="action-grid">
              <button className="btn btn-ghost" onClick={saveCurrentBuild} disabled={buildSaved}>
                <Trophy size={16} /> {buildSaved ? "Saved!" : "Save Build"}
              </button>
              <button className="btn btn-primary" onClick={beginCareer}>
                <Lock size={16} /> Start Career
              </button>
              {mode !== "daily" && dailyStats.lastCompletedDate !== todayStr() ? (
                <button className="btn btn-ghost" onClick={() => startDraft("daily")}>
                  <Calendar size={16} /> Daily Challenge
                </button>
              ) : (
                <button className="btn btn-ghost" onClick={() => startDraft(mode)}>
                  <RotateCw size={16} /> New Draft
                </button>
              )}
              <button className="btn btn-ghost" onClick={() => setShowShareBlock((v) => !v)}>
                <Copy size={16} /> Share
              </button>
            </div>

            {showShareBlock && (
              <>
                <pre className="scorecard-pre">{buildScorecardText({ name, goatScore, picks })}</pre>
                <div className="btn-row">
                  <CopyScorecardButton text={buildScorecardText({ name, goatScore, picks })} />
                  <ShareCardCanvas name={name} goatScore={goatScore} tierLabel={tierOf(goatScore).label} picks={picks} />
                </div>
              </>
            )}

            <div className="note-txt">Height/Reach are the fighters' real measurements. Skill ratings and Career Mode results are simulated for this app -- opponents are fictional, so no real fighter's record is ever touched.</div>
          </div>
        </>
      )}

      {phase === "sim" && careerState && (
        <>
        <div className={`panel sim-panel ${careerTab === "career" && (!careerState.pendingDecision || careerState.pendingDecision.type === "preFight") ? "has-advance-bar" : ""}`}>
          <div className="sim-head">
            <div>
              <div className="tagline mono" style={{ marginBottom: 2 }}>{name} &middot; {careerState.displayOverall} OVR</div>
              <div className="mono" style={{ fontSize: 14, fontWeight: 600 }}>{careerState.record.w}{"–"}{careerState.record.l}</div>
              <div className="sim-rank">{rankLabel(careerState.rankPoints, careerState.champion)}</div>
            </div>
            <div className="legacy-box">
              <div className="legacy-num" key={careerState.runningLegacy}>{careerState.runningLegacy}</div>
              <div className="legacy-lbl">Legacy Score</div>
            </div>
          </div>
          {careerState.careerStyle && (
            <div className="sim-status-row">
              <span className={`fight-tier-tag ${tierRampCls(careerState.circuitTier)}`}>{careerState.circuitTier}</span>
              <span className={`fight-tier-tag ${careerState.styleIsNaturalFit ? "on-style" : careerState.careerStyle === "Balanced" ? "" : "off-style"}`}>
                {careerState.careerStyle}{careerState.styleIsNaturalFit ? " (Natural Fit)" : careerState.careerStyle !== "Balanced" ? " (Off-Style)" : ""}
              </span>
            </div>
          )}
          <div className="progress-bar-track">
            <div className="progress-bar-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="sim-progress mono">Year {careerState.year} of {careerState.totalYears}</div>

          {/* Bottom tab nav (see the fixed bar below) splits the sim screen
              into four views. Decision-first still holds within each: a
              fight-week decision surfaces right on the Career hub, and camp
              planning gets its own tab instead of sharing this one -- an
              auto-switch effect (and a badge on the tab button) makes sure
              neither is ever missed just because the player was elsewhere. */}
          {careerTab === "career" && (
          <>
          {careerState.pendingDecision && careerState.pendingDecision.type === "fightChoice" && (
            <div className="decision-panel">
              <div className="decision-title"><Target size={15} /> Matchmaking Options</div>
              <div className="decision-sub">The promotion offers you a choice for the next booking.</div>
              <div className="choice-grid">
                <button className="choice-btn" onClick={() => handleFightChoice("easy")}>Easy Fight<span>Lower opponent, lower risk &amp; reward</span></button>
                <button className="choice-btn" onClick={() => handleFightChoice("ranked")}>Ranked Fight<span>Moderate risk, better ranking reward</span></button>
                <button className="choice-btn" onClick={() => handleFightChoice("stepUp")}>Step-Up Fight<span>Very tough, major reward</span></button>
                {!careerState.champion && careerState.rankPoints >= 85 && (
                  <button className="choice-btn danger" onClick={() => handleFightChoice("demandShot")}>Demand the Title Shot<span>Cash in the ranking, fight for the belt now</span></button>
                )}
                {!careerState.champion && careerState.rankPoints >= 65 && (
                  <button className="choice-btn danger" onClick={() => handleFightChoice("shortNoticeTitle")}>Short-Notice Title<span>Extremely risky, huge reward</span></button>
                )}
              </div>
            </div>
          )}
          {careerState.pendingDecision && careerState.pendingDecision.type === "trainingEvent" && (
            <div className="decision-panel">
              <div className="decision-title"><Target size={15} /> Training Camp</div>
              <div className="decision-sub">Your coaches see a real weakness in {ATTR_BY_KEY[careerState.pendingDecision.attr].label}.</div>
              <div className="choice-row">
                <button className="choice-btn" onClick={() => handleTrainingEvent(true)}>Address It<span>Small permanent gain, this camp's focus</span></button>
                <button className="choice-btn" onClick={() => handleTrainingEvent(false)}>Stay the Course<span>No change, no risk</span></button>
              </div>
            </div>
          )}
          {careerState.pendingDecision && careerState.pendingDecision.type === "mediaEvent" && (
            <div className="decision-panel">
              <div className="decision-title"><Megaphone size={15} /> Fight Week Media</div>
              <div className="decision-sub">Your opponent has been talking trash all week.</div>
              <div className="choice-row">
                <button className="choice-btn" onClick={() => handleMediaEvent(true)}>Fire Back<span>+Power for this fight only</span></button>
                <button className="choice-btn" onClick={() => handleMediaEvent(false)}>Stay Professional<span>+Fight IQ for this fight only</span></button>
              </div>
            </div>
          )}
          {/* Pre-fight buildup: the booking is set (opponent, odds, stakes)
              but the fight itself hasn't happened yet -- prepareFight() set
              all of this up without rolling anything. Committing (below, in
              the sticky bar) is what actually resolves it. */}
          {careerState.pendingDecision && careerState.pendingDecision.type === "preFight" && careerState.pendingFight && (
            <div className="decision-panel prefight-panel">
              {(careerState.pendingFight.isTitleShot || careerState.pendingFight.isTitleDefense) && (
                <div className="event-title-strap" style={{ marginBottom: 10 }}>
                  <Crown size={14} />
                  {careerState.pendingFight.choiceTag === "shortNoticeTitle" ? "SHORT-NOTICE TITLE FIGHT" : careerState.pendingFight.isTitleShot ? "FOR THE TITLE" : "TITLE DEFENSE"}
                </div>
              )}
              <div className="decision-title"><Calendar size={15} /> Fight Night</div>
              <div className="decision-sub">{careerState.pendingFight.fightWeekLine}</div>

              <div className="prefight-matchup">
                <div className="prefight-corner">
                  <div className="corner-label mono">YOU</div>
                  <div className="corner-name">{name}</div>
                  <div className="corner-sub mono">{careerState.record.w}-{careerState.record.l} &middot; {careerState.pendingFight.playerOverallNow} OVR</div>
                </div>
                <div className="prefight-vs mono">VS</div>
                <div className="prefight-corner opp">
                  <div className="corner-label mono">
                    {careerState.pendingFight.oppRank === 0 ? "CHAMPION" : careerState.pendingFight.oppRank ? `#${careerState.pendingFight.oppRank}` : "UNRANKED"}
                  </div>
                  <div className="corner-name">{careerState.pendingFight.oppName}</div>
                  <div className="corner-sub mono">
                    {careerState.pendingFight.oppRecord.w}-{careerState.pendingFight.oppRecord.l} &middot; {careerState.pendingFight.opp.overall} OVR
                  </div>
                </div>
              </div>

              {careerState.pendingFight.matchup && (() => {
                const m = careerState.pendingFight.matchup;
                const warn = m.label === "Dangerous Matchup" || m.label === "Nightmare Matchup";
                return (
                  <div className={`matchup-line ${warn ? "warn" : ""}`}>
                    {warn && <AlertTriangle size={12} />}
                    Your {ATTR_BY_KEY[m.yourStrength.key].label} {Math.round(m.yourStrength.value)} vs their {ATTR_BY_KEY[m.oppStrength.key].label} {Math.round(m.oppStrength.value)} &mdash; {m.label}
                  </div>
                );
              })()}

              <div className="prefight-odds-row">
                <div className={`odds-chip ${careerState.pendingFight.winProb >= 0.5 ? "favorite" : ""}`}>{careerState.pendingFight.youOdds}</div>
                <div className="odds-label mono">BETTING ODDS</div>
                <div className={`odds-chip ${careerState.pendingFight.winProb < 0.5 ? "favorite" : ""}`}>{careerState.pendingFight.oppOdds}</div>
              </div>

              <div className="interview-line">
                <Megaphone size={13} />
                <span>{careerState.pendingFight.trashTalk}</span>
              </div>
            </div>
          )}
          {/* The fight that was just committed, spotlighted right here
              instead of only living at the bottom of the history feed --
              same FightResultCard the timeline itself uses below, just
              filtered out of that list (see the timeline .filter below)
              while it's spotlighted so it isn't shown twice at once. It
              settles into the history the moment the player advances. */}
          {!careerState.pendingDecision && spotlightFightId && (() => {
            const spotlightEntry = careerState.timeline.find((e) => e.id === spotlightFightId);
            return spotlightEntry ? <FightResultCard e={spotlightEntry} playerName={name} /> : null;
          })()}
          {(!careerState.pendingDecision || careerState.pendingDecision.type === "preFight") && (
            <div className="btn-row sim-advance-bar">
              {careerState.pendingDecision && careerState.pendingDecision.type === "preFight" ? (
                <>
                  <button className="btn btn-primary" onClick={handleCommitFight}>
                    <Swords size={16} /> Fight Night
                  </button>
                  <button className="btn btn-ghost" onClick={handleFastForward} style={{ flex: "0 0 auto", width: "auto", padding: "13px 16px" }}>
                    <FastForward size={16} />
                  </button>
                </>
              ) : !careerState.finished ? (
                <>
                  <button className="btn btn-primary" onClick={handleAdvance}>
                    Next <ChevronRight size={16} />
                  </button>
                  <button className="btn btn-ghost" onClick={handleFastForward} style={{ flex: "0 0 auto", width: "auto", padding: "13px 16px" }}>
                    <FastForward size={16} />
                  </button>
                </>
              ) : (
                <button className="btn btn-dark" onClick={() => setPhase("result")}>
                  <Trophy size={16} /> See Career Verdict
                </button>
              )}
            </div>
          )}

          {/* Recent form: last few results at a glance, no scrolling required. */}
          {recentForm.length > 0 && (
            <div className="recent-form-block">
              <div className="setup-label" style={{ marginBottom: 6 }}>Recent Form</div>
              <div className="recent-form-row">
                {recentForm.map((f) => (
                  <div className={`form-pill ${f.win ? "win" : "loss"}`} key={f.id} title={`${f.win ? "W" : "L"} vs ${f.opp} (${f.method})`}>
                    {f.win ? "W" : "L"}
                  </div>
                ))}
              </div>
            </div>
          )}

          {careerState.divisionRoster && (
            <details className="rankings-details">
              <summary>{careerState.division || "Division"} Rankings</summary>
              <div className="rankings-list">
                {careerState.playerRank === 0 && (
                  <div className="ranking-row you champ">
                    <span className="rank-num mono">C</span>
                    <span className="rank-name">{name}</span>
                    <span className="rank-rec mono">{careerState.record.w}-{careerState.record.l}</span>
                  </div>
                )}
                {careerState.playerRank !== 0 && divisionChampion && (
                  <div className="ranking-row champ" key={divisionChampion.id}>
                    <span className="rank-num mono">C</span>
                    <span className="rank-name">{divisionChampion.name}</span>
                    <span className="rank-rec mono">{divisionChampion.record.w}-{divisionChampion.record.l}</span>
                  </div>
                )}
                {rankedPool.map((f, i) => {
                  const rankNum = i + 1;
                  return (
                    <React.Fragment key={f.id}>
                      {careerState.playerRank === rankNum && (
                        <div className="ranking-row you">
                          <span className="rank-num mono">#{rankNum}</span>
                          <span className="rank-name">{name}</span>
                          <span className="rank-rec mono">{careerState.record.w}-{careerState.record.l}</span>
                        </div>
                      )}
                      <div className="ranking-row">
                        <span className="rank-num mono">#{rankNum}</span>
                        <span className="rank-name">{f.name}</span>
                        <span className="rank-rec mono">{f.record.w}-{f.record.l}</span>
                      </div>
                    </React.Fragment>
                  );
                })}
                {careerState.playerRank == null && (
                  <div className="ranking-row you unranked">
                    <span className="rank-num mono">—</span>
                    <span className="rank-name">{name}</span>
                    <span className="rank-rec mono">Unranked</span>
                  </div>
                )}
              </div>
            </details>
          )}

          <div className="section-divider" style={{ marginTop: 6 }}>Career History</div>
          {careerState.timeline.filter((e) => e.id !== spotlightFightId).map((e) => {
            if (e.type === "year") return <div className="year-divider" key={e.id}>Year {e.year}</div>;
            if (e.type === "campPlan") {
              const stanceLabel = e.stance === "standup" ? "Stand-Up" : e.stance === "ground" ? "Ground" : "Balanced";
              const showLeap = e.year >= 3 && e.year <= 5;
              const madeTheLeap = e.rankSnapshot >= 60;
              return (
                <div className="event-card" style={{ alignItems: "flex-start" }} key={e.id}>
                  <Sparkles size={15} style={{ marginTop: 2 }} />
                  <div>
                    <div>
                      {e.campQuality === "full" ? "Full camp" : "Short notice"} &middot; {stanceLabel} gameplan
                      {e.focusAttr ? ` · focused on ${ATTR_BY_KEY[e.focusAttr].label}` : ""}
                    </div>
                    {showLeap && (
                      <div className="leap-note">
                        {madeTheLeap ? "The leap is happening — real contender buzz now." : "Still waiting for the leap — needs a statement win."}
                      </div>
                    )}
                  </div>
                </div>
              );
            }
            if (e.type === "yearEnd") {
              const beforeLabel = rankLabel(e.rankBefore, e.championBefore);
              const afterLabel = rankLabel(e.rankAfter, e.championAfter);
              return (
                <div className="year-end-card" key={e.id}>
                  <div className="year-end-title">Year {e.year} Recap</div>
                  <div className="summary-row"><span>Record</span><b>{e.wins}-{e.losses}</b></div>
                  <div className="summary-row"><span>Ranking</span><b>{beforeLabel === afterLabel ? afterLabel : `${beforeLabel} → ${afterLabel}`}</b></div>
                  {e.bestWin && <div className="summary-row"><span>Best Win</span><b>vs {e.bestWin.opp} ({e.bestWin.oppRating})</b></div>}
                  {e.toughestLoss && <div className="summary-row"><span>Toughest Loss</span><b>vs {e.toughestLoss.opp} ({e.toughestLoss.oppRating})</b></div>}
                </div>
              );
            }
            if (e.type === "retirement") {
              return (
                <div className="retirement-card" key={e.id}>
                  <Award size={18} />
                  <div className="retirement-line">{e.line}</div>
                </div>
              );
            }
            if (e.type === "injury") {
              return (
                <div className="event-card bad" key={e.id}>
                  <AlertTriangle size={15} />
                  {e.major ? "Major injury — the entire year is lost to recovery." : "Nagging injury — the camp schedule takes a hit."}
                </div>
              );
            }
            if (e.type === "interim") {
              return (
                <div className="event-card bad" key={e.id}>
                  <Crown size={15} /> Title vacated while sidelined — the promotion books an interim title fight.
                </div>
              );
            }
            if (e.type === "hypeEvent") {
              return (
                <div className={`event-card ${e.positive ? "good" : "bad"}`} key={e.id}>
                  <Megaphone size={15} /> {e.text}
                </div>
              );
            }
            if (e.type === "styleSelected") {
              return (
                <div className="event-card good" key={e.id}>
                  <Swords size={15} />
                  Fighting as a <b>{e.style}</b>{e.naturalFit ? " — your natural fit, full stat bonus every fight." : e.style !== "Balanced" ? " — against your natural grain: no stat bonus, but wins carry extra Legacy." : "."}
                </div>
              );
            }
            if (e.type === "circuitMove") {
              const t = clfTier(e.to);
              return (
                <div className={`promotion-card ${e.promoted ? "up" : "down"}`} key={e.id}>
                  <div className="promotion-eyebrow mono">
                    {e.promoted ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                    {e.promoted ? "SIGNED — MOVING UP" : "RELEASED — MOVING DOWN"}
                  </div>
                  <div className={`promotion-tier display ${tierRampCls(e.to)}`}>{t.short}</div>
                  <div className="promotion-blurb">{t.blurb}</div>
                  <div className="promotion-from mono">{e.from} → {e.to}</div>
                </div>
              );
            }
            if (e.type === "rivalEvent") {
              return (
                <div className="event-card rival" key={e.id}>
                  <Swords size={15} /> A rivalry is born with <b>{e.oppName}</b> — expect to see him again.
                </div>
              );
            }
            if (e.type === "trainingEvent") {
              return (
                <div className={`event-card ${e.addressed ? "good" : ""}`} key={e.id}>
                  <Target size={15} />
                  {e.addressed
                    ? `Camp addresses the ${ATTR_BY_KEY[e.attr].label} weakness — a small, permanent gain.`
                    : `Coaches flagged a ${ATTR_BY_KEY[e.attr].label} weakness, but camp stayed the course.`}
                </div>
              );
            }
            if (e.type === "mediaEvent") {
              return (
                <div className="event-card" key={e.id}>
                  <Megaphone size={15} />
                  {e.fireBack ? "Fired back at the trash talk — extra motivation for the next fight." : "Stayed professional and let the talking happen in the cage."}
                </div>
              );
            }
            if (e.type === "weightMove") {
              return (
                <div className="event-card" key={e.id}>
                  {e.direction === "up" ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
                  Moving {e.direction} a weight class — a short adjustment period follows.
                </div>
              );
            }
            if (e.type === "summary") {
              return (
                <div className="summary-card" key={e.id}>
                  <div className="summary-title">Career Complete — Legacy Finalized</div>
                  <div className="summary-row"><span>Finish rate</span><b>{e.finishRate}%</b></div>
                  <div className="summary-row"><span>Strength of schedule</span><b>{e.strengthOfSchedule} avg opp</b></div>
                  <div className="summary-row"><span>Peak ranking</span><b>{rankLabel(e.peakRankPoints, false)}</b></div>
                  <div className="summary-row"><span>Fights as a contender</span><b>{e.rankedFightCount}</b></div>
                  <div className="summary-row"><span>Statement wins</span><b>{e.statementWins}</b></div>
                  <div className="summary-row"><span>Rivalries won</span><b>{e.rivalryWins}</b></div>
                  <div className="summary-row"><span>Legacy bonus</span><b>+{e.bonus}</b></div>
                </div>
              );
            }
            return <FightResultCard e={e} playerName={name} key={e.id} />;
          })}
          </>
          )}

          {careerTab === "rankings" && careerState.divisionRoster && (
            <div className="rankings-list rankings-list-tab">
              {careerState.playerRank === 0 && (
                <div className="ranking-row you champ">
                  <span className="rank-num mono">C</span>
                  <span className="rank-name">{name}</span>
                  <span className="rank-rec mono">{careerState.record.w}-{careerState.record.l}</span>
                </div>
              )}
              {careerState.playerRank !== 0 && divisionChampion && (
                <div className="ranking-row champ" key={divisionChampion.id}>
                  <span className="rank-num mono">C</span>
                  <span className="rank-name">{divisionChampion.name}</span>
                  <span className="rank-rec mono">{divisionChampion.record.w}-{divisionChampion.record.l}</span>
                </div>
              )}
              {rankedPool.map((f, i) => {
                const rankNum = i + 1;
                return (
                  <React.Fragment key={f.id}>
                    {careerState.playerRank === rankNum && (
                      <div className="ranking-row you">
                        <span className="rank-num mono">#{rankNum}</span>
                        <span className="rank-name">{name}</span>
                        <span className="rank-rec mono">{careerState.record.w}-{careerState.record.l}</span>
                      </div>
                    )}
                    <div className="ranking-row">
                      <span className="rank-num mono">#{rankNum}</span>
                      <span className="rank-name">{f.name}</span>
                      <span className="rank-rec mono">{f.record.w}-{f.record.l}</span>
                    </div>
                  </React.Fragment>
                );
              })}
              {careerState.playerRank == null && (
                <div className="ranking-row you unranked">
                  <span className="rank-num mono">—</span>
                  <span className="rank-name">{name}</span>
                  <span className="rank-rec mono">Unranked</span>
                </div>
              )}
            </div>
          )}

          {careerTab === "stats" && (
            <div className="stat-grid" style={{ marginTop: 4 }}>
              {[
                { num: `${careerState.record.w}-${careerState.record.l}`, lbl: "Record" },
                { num: careerState.streak > 0 ? `W${careerState.streak}` : careerState.streak < 0 ? `L${-careerState.streak}` : "—", lbl: "Current Streak" },
                { num: careerState.longestStreak, lbl: "Best Streak" },
                { num: careerState.finishes.ko, lbl: "KO/TKO" },
                { num: careerState.finishes.sub, lbl: "Submissions" },
                { num: careerState.finishes.dec, lbl: "Decisions" },
                { num: careerState.titleReigns, lbl: "Title Reigns" },
                { num: careerState.titleDefenses, lbl: "Title Defenses" },
                { num: rankLabel(careerState.peakRankPoints, false), lbl: "Peak Ranking" },
                { num: careerState.statementWins, lbl: "Statement Wins" },
                { num: careerState.rivalryWins, lbl: "Rivalries Won" },
                { num: careerState.runningLegacy, lbl: "Legacy Score" },
              ].map((s) => (
                <div className="stat-box" key={s.lbl}>
                  <div className="stat-num">{s.num}</div>
                  <div className="stat-lbl">{s.lbl}</div>
                </div>
              ))}
            </div>
          )}

          {careerTab === "camp" && (
            careerState.pendingDecision && careerState.pendingDecision.type === "campPlanning" ? (
              <CampPlanningPanel
                onConfirm={handleCampConfirm}
                year={careerState.year}
                isFinalYear={careerState.year === careerState.totalYears}
                currentStats={applyAging(careerState.base, careerState.year, careerState.wear)}
              />
            ) : (
              <div className="camp-idle-view">
                {lastCampPlan ? (
                  <div className="event-card" style={{ alignItems: "flex-start" }}>
                    <Sparkles size={15} style={{ marginTop: 2 }} />
                    <div>
                      Last camp: {lastCampPlan.campQuality === "full" ? "Full camp" : "Short notice"} &middot; {lastCampPlan.stance === "standup" ? "Stand-Up" : lastCampPlan.stance === "ground" ? "Ground" : "Balanced"} gameplan
                      {lastCampPlan.focusAttr ? ` · focused on ${ATTR_BY_KEY[lastCampPlan.focusAttr].label}` : ""}
                    </div>
                  </div>
                ) : (
                  <div className="empty-txt">No camp planned yet — the next one opens up as your career moves forward.</div>
                )}
              </div>
            )
          )}
        </div>

        <div className="tab-bar-fixed">
          {[
            { id: "career", label: "Career", icon: Swords },
            { id: "rankings", label: "Rankings", icon: ListOrdered },
            { id: "stats", label: "Stats", icon: BarChart3 },
            { id: "camp", label: "Camp", icon: Dumbbell },
          ].map((t) => {
            const Icon = t.icon;
            const pendingHere = careerState.pendingDecision && (
              t.id === "camp"
                ? careerState.pendingDecision.type === "campPlanning"
                : t.id === "career" && careerState.pendingDecision.type !== "campPlanning"
            );
            return (
              <button key={t.id} className={`tab-bar-btn ${careerTab === t.id ? "active" : ""}`} onClick={() => setCareerTab(t.id)}>
                <span className="tab-bar-icon-wrap">
                  <Icon size={18} />
                  {pendingHere && careerTab !== t.id && <span className="tab-bar-badge" />}
                </span>
                {t.label}
              </button>
            );
          })}
        </div>
        </>
      )}

      {phase === "result" && careerState && careerState.finished && (() => {
        const retirementBeat = careerState.timeline.find((e) => e.type === "retirement");
        const summary = careerState.timeline.find((e) => e.type === "summary");
        return (
        <div className="panel verdict-panel">
          <Award size={30} color="var(--brass)" />
          <div className="verdict-eyebrow mono reveal-stagger reveal-delay-1">{name} &middot; {careerState.displayOverall} OVR &middot; GOAT {goatScore}</div>
          <div className="verdict-title reveal-stagger reveal-delay-1">{careerState.verdict}</div>
          {retirementBeat && (
            <div className="retirement-beat reveal-stagger reveal-delay-2">{retirementBeat.line}</div>
          )}
          <div className="mono reveal-stagger reveal-delay-3" style={{ fontSize: 13, color: "var(--slate)" }}>
            {careerState.record.w}-{careerState.record.l} &middot; Legacy Score <AnimatedGoatScore score={careerState.legacyScore} reducedMotion={reducedMotion} />
          </div>
          {/* Legacy Score is the whole career, uneven years and all -- Best
              Year is tracked and shown separately so a career that peaked
              early (or late) doesn't get flattened into one number. */}
          {summary && (
            <div className="mono reveal-stagger reveal-delay-3" style={{ fontSize: 11, color: "var(--slate)", marginTop: 2 }}>
              Best Year <b style={{ color: "var(--brass)" }}>{summary.peakYearLegacy}</b> &middot; {summary.yearsActive} {summary.yearsActive === 1 ? "Year" : "Years"} Active
            </div>
          )}

          {/* Badges drop in one at a time rather than all appearing at once,
              matching the GOAT-reveal treatment on the draft result screen. */}
          <div className="stat-grid">
            {[
              { num: careerState.finishes.ko, lbl: "KO/TKO" },
              { num: careerState.finishes.sub, lbl: "Submissions" },
              { num: careerState.titleReigns, lbl: "Title Reigns" },
              { num: careerState.titleDefenses, lbl: "Title Defenses" },
              { num: careerState.longestStreak, lbl: "Best Streak" },
              { num: rankLabel(careerState.peakRankPoints, false), lbl: "Peak Ranking" },
              { num: careerState.statementWins, lbl: "Statement Wins" },
              { num: careerState.rivalryWins, lbl: "Rivalries Won" },
              { num: `${careerState.record.w}-${careerState.record.l}`, lbl: "Record" },
            ].map((s, i) => (
              <div className="stat-box reveal-stagger" style={reducedMotion ? undefined : { animationDelay: `${0.65 + i * 0.08}s` }} key={s.lbl}>
                <div className="stat-num">{s.num}</div>
                <div className="stat-lbl">{s.lbl}</div>
              </div>
            ))}
          </div>

          {/* Broadcast-style signature wins -- the actual names beat, not
              just a count (statementWins above already covers the count). */}
          {summary && summary.topWins && summary.topWins.length > 0 && (
            <div className="signature-wins-block reveal-stagger reveal-delay-5">
              <div className="setup-label" style={{ marginBottom: 6 }}>Signature Wins</div>
              {summary.topWins.map((w, i) => (
                <div className="signature-win-row" key={i}>
                  {(w.titleShot || w.titleDefense) && <Crown size={12} />}
                  <span>def. {w.opp}</span>
                  <span className="mono">{w.method.replace(" Loss", "")} &middot; {w.oppRating} OVR</span>
                </div>
              ))}
            </div>
          )}

          {careerState.definingLoss && (
            <div className="whatif-block">
              <button className="btn btn-ghost" onClick={replayDefiningLoss}>
                <Repeat size={16} /> What If? Replay vs {careerState.definingLoss.oppName}
              </button>
              {whatIf && (
                <div className={`event-card ${whatIf.win ? "good" : "bad"}`} style={{ marginTop: 10 }}>
                  {whatIf.win
                    ? `You get it back! ${whatIf.method} over ${whatIf.oppName}.`
                    : `Same result — ${whatIf.method} to ${whatIf.oppName} again.`}
                </div>
              )}
            </div>
          )}

          <pre className="scorecard-pre">{buildScorecardText({ name, goatScore, picks, career: careerState })}</pre>

          <div className="btn-row">
            <CopyScorecardButton text={buildScorecardText({ name, goatScore, picks, career: careerState })} />
            <ShareCardCanvas name={name} goatScore={goatScore} tierLabel={tierOf(goatScore).label} picks={picks} />
          </div>
          <div className="btn-row">
            <button className="btn btn-ghost" onClick={saveCurrentBuild} disabled={buildSaved}>
              <Trophy size={16} /> {buildSaved ? "Saved!" : "Save Build"}
            </button>
            <button className="btn btn-ghost" onClick={runItBack}>
              <RotateCw size={16} /> Run It Back (New Division)
            </button>
          </div>

          <div className="btn-row">
            {mode === "daily" ? (
              <button className="btn btn-primary" onClick={goHome}>
                <Home size={16} /> Back to Home
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => startDraft(mode)}>
                <RotateCw size={16} /> Play Again
              </button>
            )}
            <button className="btn btn-ghost" onClick={goHome}>
              <Home size={16} /> Home
            </button>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
