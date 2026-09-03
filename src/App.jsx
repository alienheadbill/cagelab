import React, { useState, useRef, useEffect } from "react";
import {
  Trophy, ChevronRight, Lock, RotateCw, Shuffle, Users, MapPin, AlertTriangle,
  Crown, FastForward, Sparkles, TrendingUp, TrendingDown, Calendar, Copy,
  Moon, Sun, Home, Volume2, VolumeX, Link2, Repeat, HelpCircle,
  Target, Megaphone, Award, Globe, Loader2, Swords, BarChart3, ListOrdered, Dumbbell,
  FileSignature, GraduationCap, Wallet, Flame, FlaskConical, Mic, Zap,
} from "lucide-react";

import "./styles.css";

import { ATTRS, ATTR_BY_KEY, WEIGHT_CLASSES, erasForClass } from "./data/attrs.js";
import { BOARD_SIZE, rosterFor, boardFor, pickCompatiblePair, pickEraWithinClass, generateOpponentNames } from "./data/fighters.js";
import { mulberry32, seedFromDateStr, todayStr, yesterdayStr, encodeSeed, shuffle } from "./lib/rng.js";
import {
  LS_PREF_MODE, LS_DAILY_STATS, LS_SAVED_BUILDS, LS_CAREER_HISTORY, LS_DARK_MODE,
  LS_SOUND_ON, LS_REDUCED_MOTION, LS_DAILY_LOG, LS_DISPLAY_NAME,
  LS_HAS_VISITED, LS_SEEN_DRAFT_HINT,
  loadJSON, saveJSON, defaultDailyStats,
} from "./lib/storage.js";
import {
  SUPABASE_ENABLED, submitDailyScore, fetchDailyLeaderboard,
  submitChallengeScore, fetchChallengeLeaderboard,
} from "./lib/supabase.js";
import { sfx } from "./lib/audio.js";
import { formatHeight, formatPurse, formatReach } from "./lib/utils.js";
import {
  tierOf, computeGoatScore, computeGoatScoreBreakdown, computeBuildValueBreakdown, relativeHeightScore,
  relativeReachScore, relativeNoteFor, archetypeFor, synergiesFor,
  strengthsWeaknesses, buildScorecardText, matchupProfileFor,
} from "./lib/scoring.js";
import {
  DIVISION_SIZE, CLF_TIERS, CONTRACT_TYPES, rankLabel, clfTier, hasCalloutAccess, applyAging, resolveFight, initCareer,
  resolveCampPlanning, resolveTrainingEvent, resolveMediaEvent, resolveOffCycleEvent,
  resolveContractNegotiation, resolveWeightMoveOffer, resolveMilestone, prepareFight, commitFight,
  advanceCareer, fastForwardCareer, playSfxForTransition, computePlayerProfile,
  computeAchievements, ARCHETYPE_TAGLINES,
} from "./lib/career.js";

import TierIcon from "./components/TierIcon.jsx";
import CopyScorecardButton from "./components/CopyScorecardButton.jsx";
import ShareCardCanvas from "./components/ShareCardCanvas.jsx";
import RadarChart from "./components/RadarChart.jsx";
import AnimatedGoatScore from "./components/AnimatedGoatScore.jsx";
import BlindGoatReveal from "./components/BlindGoatReveal.jsx";
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
import LabScreen from "./components/LabScreen.jsx";

// Career History used to render strictly oldest-first, so on anything but a
// brand-new career the most recent fight or event -- the thing you'd
// actually want to look at -- sank further and further below a permanent
// wall of Year 1 content. Groups by the "year" divider entries and
// reverses the GROUPS (most recent year first), while keeping each year's
// own events in the order they actually happened -- camp -> fights ->
// recap still reads as a story, it just doesn't make you scroll to the
// bottom of an 11-year career to find it.
function groupTimelineNewestYearFirst(timeline) {
  const groups = [];
  let current = null;
  for (const e of timeline) {
    if (e.type === "year" || !current) {
      current = [];
      groups.push(current);
    }
    current.push(e);
  }
  return groups.reverse().flat();
}

// Framing for the 3 real candidates the matchmaking panel offers -- same
// risk/reward promise the old abstract Easy/Ranked/Step-Up buttons made,
// just attached to an actual named fighter now instead of a hidden draw.
const MATCHMAKER_TAG_META = {
  easy: { label: "Easy Fight", sub: "Lower risk & reward" },
  ranked: { label: "Ranked Fight", sub: "Moderate risk, better reward" },
  stepUp: { label: "Step-Up Fight", sub: "Tough test, major reward" },
};

// A truthful empty state for Ranked/Step-Up when nobody in the division
// actually qualifies -- shown instead of ever substituting an unranked or
// bad-form fighter under a premium label.
const MATCHMAKER_UNAVAILABLE_META = {
  ranked: { title: "No Ranked Opponent Available", blurb: "Nobody in the Top 15 is bookable right now." },
  stepUp: { title: "No Step-Up Available", blurb: "No contender has enough momentum to justify the booking right now." },
};

// Live presentation copy for the four circuitMove transitions -- keyed by
// the exact from->to the engine already produces, so a new/unexpected
// pairing just fails the lookup (defensive no-op) instead of ever
// mismatching a transition to the wrong copy. Only these four exist in the
// current ladder (see career.js's tier-promotion block).
const MILESTONE_COPY = {
  "CLF Regional->CLF National": {
    eyebrow: "THE CALL CAME IN", showTitle: true, title: "SIGNED — MOVING UP", tierLabel: null,
    blurb: "Televised cards. Bigger crowds. The division knows your name now.",
    showTransition: true, cta: "ENTER NATIONAL",
  },
  "CLF National->CLF Contender Series": {
    eyebrow: "YOU GOT THE INVITE", showTitle: false, tierLabel: null,
    blurb: "ONE FIGHT. ONE CONTRACT. Win here and you're on the Premier roster.",
    showTransition: true, cta: "ACCEPT THE OPPORTUNITY",
  },
  "CLF Contender Series->CLF PREMIER": {
    eyebrow: "CONTRACT EARNED", showTitle: true, title: "WELCOME TO", tierLabel: null,
    blurb: "You made the show. The main roster is waiting.",
    showTransition: false, cta: "CONTINUE",
  },
  "CLF Contender Series->CLF National": {
    eyebrow: "NOT TONIGHT", showTitle: false, tierLabel: "CONTENDER SERIES",
    blurb: "The contract doesn't come. You're heading back to National — but your standing isn't erased.",
    showTransition: true, cta: "BACK TO WORK",
  },
};

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
  const [calloutOpen, setCalloutOpen] = useState(false);
  // Mic Time's target pick -- the one opponent-picking surface with a real
  // pause after the tap (the spotlight's own Continue button), so it's the
  // one place a tap just highlights instead of booking outright; see
  // handleSelectMicTimeTarget/handleAdvance. Matchmaker cards and the
  // callout list book on a single tap, same as everything else in their
  // panel (Demand the Title Shot, etc.) -- no selection state needed there.
  // { tag, targetId, name } | null.
  const [selectedTarget, setSelectedTarget] = useState(null);
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
  // First-ever visit to this browser -- read once (pure, so it's safe if
  // StrictMode double-invokes this initializer in dev), stays true in
  // memory for the rest of THIS session so the welcome treatment doesn't
  // vanish the instant they navigate away from the home screen and back.
  // The actual "mark as seen" write happens in the effect below instead of
  // here -- a side effect inside a lazy initializer is exactly what
  // StrictMode's double-invoke is designed to catch. Now settable (Replay
  // Intro flips it back to true later in the same session) -- the ref below
  // remembers the ORIGINAL mount-time value specifically so that replay
  // doesn't immediately re-trigger the "mark as seen" write and cancel
  // itself out.
  const [isFirstVisit, setIsFirstVisit] = useState(() => !loadJSON(LS_HAS_VISITED, false));
  const wasFirstVisitAtMount = useRef(isFirstVisit);
  useEffect(() => {
    if (wasFirstVisitAtMount.current) saveJSON(LS_HAS_VISITED, true);
  }, []);
  const [seenDraftHint, setSeenDraftHint] = useState(() => loadJSON(LS_SEEN_DRAFT_HINT, false));
  // Replay Intro (My Legacy > settings) -- resets exactly the two existing
  // onboarding flags and nothing else, then goes home so the first-visit
  // hierarchy and the welcome banner are immediately visible again this
  // session. No new storage keys.
  function replayIntro() {
    saveJSON(LS_HAS_VISITED, false);
    saveJSON(LS_SEEN_DRAFT_HINT, false);
    setIsFirstVisit(true);
    setSeenDraftHint(false);
    goHome();
  }
  const [challengeBoard, setChallengeBoard] = useState([]);
  const [challengeBoardLoading, setChallengeBoardLoading] = useState(false);
  const [dailyResultBoard, setDailyResultBoard] = useState([]);
  const [dailyResultLoading, setDailyResultLoading] = useState(false);
  const [challengeSeed, setChallengeSeed] = useState(null);
  const [whatIf, setWhatIf] = useState(null);
  const [pickedFighterId, setPickedFighterId] = useState(null);
  const [isRolling, setIsRolling] = useState(false);
  const [rollPreview, setRollPreview] = useState(null);
  // The single source of truth for "what was the most recently committed
  // pick" -- set at the exact moment handlePick commits it to `picks`, and
  // read by both the round-panel lock-in confirmation and TapeCard's
  // caption, so the two can never disagree about which pick is "current"
  // the way the old order[round-2]-derived lastPickedKey used to (it only
  // advanced when `round` did, a full transition late).
  const [lastPick, setLastPick] = useState(null);
  // Highlights the just-filled slot in TapeCard for a few seconds after it
  // fills -- separate from lastPick (which persists until the NEXT pick,
  // however long that takes) because this one decays on its own clock.
  const [newestSlotKey, setNewestSlotKey] = useState(null);
  const newestSlotTimeoutRef = useRef(null);
  // True for a brief beat between the final pick landing and the reveal
  // screen actually mounting -- the "LOCKING IN YOUR BUILD..." interstitial.
  // Every other round transition already gets one (see isRolling); the
  // final one, the most important transition in the whole draft, used to
  // hard-cut straight into the reveal with no anticipation beat at all.
  const [revealPending, setRevealPending] = useState(false);
  const rollTimeoutRef = useRef(null);
  const pickTimeoutRef = useRef(null);
  const revealTimeoutRef = useRef(null);
  const dailyRngRef = useRef(null);

  useEffect(() => {
    if (!revealPending) return undefined;
    // Reduced Motion removes the wait itself, not just the animation --
    // same convention as AnimatedGoatScore's own count-up.
    revealTimeoutRef.current = setTimeout(() => setRevealPending(false), reducedMotion ? 0 : 700);
    return () => clearTimeout(revealTimeoutRef.current);
  }, [revealPending, reducedMotion]);

  // No stale selection survives into a different decision, a different
  // spotlighted fight, or a phase change -- a fightChoice re-roll, moving
  // on from the spotlight, or leaving Career entirely all invalidate
  // whatever was selected before them.
  const pendingDecisionType = careerState && careerState.pendingDecision && careerState.pendingDecision.type;
  useEffect(() => {
    setSelectedTarget(null);
  }, [pendingDecisionType, spotlightFightId, phase]);

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

  function goHome() {
    // Abandoning a draft before it produced a real GOAT score shouldn't
    // leave its `mode` tag hanging around in state for whatever happens
    // next -- e.g. an accidental tap on the Daily card, backed out of
    // immediately via this exact button, used to silently carry "daily"
    // into an unrelated Career started right after (nothing else ever
    // resets `mode` on its own). A draft that actually finished (goatScore
    // set) is a real result, so its mode is left alone -- the player might
    // still come back and start a Career from it correctly tagged.
    if (goatScore === null) setMode("classic");
    setPhase("home");
  }
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
    clearTimeout(revealTimeoutRef.current);
    clearTimeout(newestSlotTimeoutRef.current);
    setRevealPending(false);
    setPickedFighterId(null);
    setIsRolling(false);
    setRollPreview(null);
    setLastPick(null);
    setNewestSlotKey(null);
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
    return { fighter: fighter.n, raw: rating, display: String(rating), scoreValue: rating, relativeNote: relativeNoteFor("skill", rating) };
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
    const value = valueFor(fighter, currentAttrKey);
    // A 96+ pick is the one moment GOAT Score itself calls special (the
    // full elite bonus, see computeGoatScoreBreakdown) -- give it a
    // distinct chime instead of the same tone every pick gets. Gated on
    // !blind: the real rating is still computed under the hood there (the
    // display just hides it), so this can't fire without leaking exactly
    // the number Blind mode is built to hide.
    sfx(!blind && value.scoreValue >= 96 ? "elite" : "select");
    setPickedFighterId(fighter.id);
    const nextPicks = { ...picks, [currentAttrKey]: value };
    const isFinalRound = round >= ATTRS.length;

    pickTimeoutRef.current = setTimeout(() => {
      setPicks(nextPicks);
      setPickedFighterId(null);
      // Single source of truth for "the pick that just committed" -- see
      // the lastPick declaration above. Set in the exact same tick as
      // setPicks, so TapeCard's slot and caption, and the round-panel
      // lock-in confirmation, always describe the same pick.
      setLastPick({ key: currentAttrKey, value });
      // The newest-slot highlight runs on its own real-time clock (not
      // tied to reducedMotion -- it's a static state, not an animation,
      // and reduced-motion players get MORE benefit from it since they
      // never see the one-time pop-in). Cleared and restarted on every
      // pick; also cleared in startDraft so a stale timeout from an
      // abandoned draft can't reach into a fresh one.
      setNewestSlotKey(currentAttrKey);
      clearTimeout(newestSlotTimeoutRef.current);
      newestSlotTimeoutRef.current = setTimeout(() => setNewestSlotKey(null), 1800);

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
        // The final pick's own select-pop animation already had its full
        // 300ms above -- this brief interstitial is the deliberate beat
        // AFTER that, before the reveal itself mounts (see revealPending
        // effect). All reveal data is ready and set above; only the
        // render is held back a moment.
        setRevealPending(true);
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


  // Flat, storable snapshot of a picks object -- shared by saveCurrentBuild
  // and saveCareerToHistory so a historical career's build looks exactly
  // like a normally-saved one and can reuse the same reconstruction/render
  // path (see AttributeBarList usage in CollectionScreen).
  function picksSnapshotArray(picksObj) {
    return ATTRS.map((a) => ({
      key: a.key, label: a.label, fighter: picksObj[a.key].fighter,
      display: picksObj[a.key].display, scoreValue: picksObj[a.key].scoreValue, raw: picksObj[a.key].raw,
    }));
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
      // The division this build was actually drafted in, and the real
      // height/reach (in inches) of whichever real fighters got drafted for
      // those two rounds -- both now carry straight into Career Setup
      // instead of being re-picked there (see CareerSetupPanel).
      division: lockedDivision,
      picks: picksSnapshotArray(picks),
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
      restoredPicks[p.key] = { fighter: p.fighter, display: p.display, scoreValue: p.scoreValue, raw: p.raw };
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

  // Careers kept in history, newest first -- raised from 10. Ten was too
  // small to feel like an archive, and computePlayerProfile's lifetime
  // totals (careersCompleted, championships, hofCareers) already read this
  // array's full length/contents, so anyone past 10 completed careers was
  // silently undercounting their own lifetime stats even before My Legacy
  // existed -- this also fixes that.
  const CAREER_HISTORY_CAP = 50;

  // Snapshots a finished career for My Legacy. Everything here is read
  // straight off `result` (the just-finished careerState) or the current
  // `picks`/`goatScore` closure -- both are guaranteed to still describe
  // THIS career, since a new draft can't start while one is in progress.
  // No new career.js state was added to support this: peakPlayerRank,
  // peakCircuitTier, division, careerStyle, and the final champion flag
  // were already being computed and held on careerState, just never
  // persisted past the session. This is a one-time snapshot, not a live
  // value -- if ranking or scoring formulas change later, this entry does
  // not recompute or drift; it stays exactly what was true when this
  // career ended.
  function saveCareerToHistory(result) {
    const history = loadJSON(LS_CAREER_HISTORY, []);
    const entry = {
      id: Date.now().toString(36), savedAt: new Date().toISOString(),
      fighterName: name, record: result.record, verdict: result.verdict,
      legacyScore: result.legacyScore, titleReigns: result.titleReigns,
      titleDefenses: result.titleDefenses, rivalryWins: result.rivalryWins,
      statementWins: result.statementWins, longestStreak: result.longestStreak,
      totalFightCount: result.totalFightCount, wonTitleAsUnderdog: result.wonTitleAsUnderdog,
      peakPlayerRank: result.peakPlayerRank, peakCircuitTier: result.peakCircuitTier,
      division: result.division, careerStyle: result.careerStyle, champion: result.champion,
      goatScore, buildValue: buildValueInfo ? buildValueInfo.buildValue : null,
      picks: picksSnapshotArray(picks),
    };
    saveJSON(LS_CAREER_HISTORY, [entry, ...history].slice(0, CAREER_HISTORY_CAP));
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
    // Re-sync `mode` to whichever build is actually being launched, rather
    // than trusting whatever the app's live mode happens to be -- picking a
    // saved build here (originally drafted Daily, say) shouldn't leave a
    // Classic run afterward mislabeled, and vice versa.
    setMode(opts.originMode || "classic");
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
    // Dismissing the spotlight reveals whatever's next -- a pending
    // milestone, an existing pendingDecision (contract negotiation,
    // chiefly), or normal flow -- without ever skipping past any of them
    // by advancing the underlying career state in the same click. The
    // fight settles into the normal history feed the moment it clears.
    // A Mic Time pick (see handleSelectMicTimeTarget) stays highlighted
    // right up until this tap -- Continue is the actual commit point: if
    // a target is selected, book the callout first (same
    // handleFightChoice/prepareFight path a matchmaker pick uses), THEN
    // dismiss the spotlight. Nothing selected is the unchanged decline
    // path -- just dismiss.
    if (spotlightFightId) {
      if (selectedTarget) {
        const { tag, targetId } = selectedTarget;
        setSelectedTarget(null);
        handleFightChoice(tag, targetId);
      }
      setSpotlightFightId(null);
      return;
    }
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
  function handleFightChoice(tag, targetId) {
    // Picking a booking type no longer resolves the fight on the spot --
    // it sets up the opponent/odds and hands off to the pre-fight screen
    // (pendingDecision "preFight"), same as a default booking does. Nothing
    // has actually happened yet, so no transition sfx or history save here;
    // that's handleCommitFight's job once the player confirms.
    sfx("select");
    setCareerState(prepareFight(careerState, tag, targetId));
  }
  // Mic Time is the one target-picking surface that has a real "next" step
  // of its own (the spotlight's Continue button) sitting right below it, so
  // it's the one place a tap just highlights rather than booking outright --
  // tapping a different target moves the highlight, tapping the same one
  // again clears it, and it stays lit until Continue (handleAdvance above)
  // reads it. Matchmaker cards and the callout list have no such pause --
  // choosing there IS the next step, same as Demand the Title Shot right
  // next to them -- so those call handleFightChoice directly, single tap.
  function handleSelectMicTimeTarget(tag, targetId, name) {
    sfx("select");
    setSelectedTarget((cur) => (cur && cur.targetId === targetId ? null : { tag, targetId, name }));
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
  function handleOffCycleEvent(choice) {
    sfx("select");
    setCareerState(resolveOffCycleEvent(careerState, choice));
  }
  function handleWeightMoveOffer(accept) {
    sfx("select");
    setCareerState(resolveWeightMoveOffer(careerState, accept));
  }
  function handleContractNegotiation(contractId) {
    sfx("select");
    setCareerState(resolveContractNegotiation(careerState, contractId));
  }
  function handleAcknowledgeMilestone() {
    sfx("select");
    setCareerState(resolveMilestone(careerState));
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
  // Analytical only -- never read by anything in career.js, never changes a
  // fight outcome. Guarded the same way goatTier is: only meaningful once
  // all 10 attributes are actually locked in.
  const buildValueInfo = goatScore !== null ? computeBuildValueBreakdown(picks) : null;

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

  // What actually gets you promoted off the tier you're currently on --
  // mirrors the real gate logic in career.js's commitFight exactly, so this
  // text can never drift out of sync with what the game actually checks.
  function circuitNextRequirement(tierName, isChampion) {
    if (tierName === "CLF Regional") return "Win the Regional title to move up to National.";
    if (tierName === "CLF National") return "Win the National title, or string together a serious win streak on its own, to earn a shot in the Contender Series.";
    if (tierName === "CLF Contender Series") return "One showcase fight decides it -- win it and the Premier contract is waiting. Lose it and it's back to National, standing untouched.";
    return isChampion
      ? "You hold the Premier title -- the top of the ladder. Defend it and build the legacy."
      : "You've reached Premier -- the top of the ladder. Win the title and defend it to build the legacy.";
  }

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

  // Season-at-a-glance: how THIS year is going, not the whole career.
  // Scans back to the most recent "year" divider -- same convention
  // career.js's own summarizeYear() uses for the year-end recap -- so this
  // reads as "this year so far" without waiting for the year to actually
  // end. lastCampPlan above already lands inside this same window (a camp
  // is planned once, right as each year starts), so it doubles as this
  // year's plan with no separate lookup needed.
  const thisYearFights = careerState
    ? careerState.timeline.slice(careerState.timeline.map((e) => e.type).lastIndexOf("year") + 1).filter((e) => e.type === "fight")
    : [];
  const thisYearWins = thisYearFights.filter((f) => f.win).length;
  const thisYearLosses = thisYearFights.length - thisYearWins;

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
          onLab={() => setPhase("lab")}
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
          isFirstVisit={isFirstVisit}
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
          onReplayIntro={replayIntro}
        />
      )}

      {phase === "lab" && (
        <LabScreen
          onBack={goHome}
          savedBuilds={loadJSON(LS_SAVED_BUILDS, [])}
          careerHistory={loadJSON(LS_CAREER_HISTORY, [])}
        />
      )}

      {phase === "careerSetup" && (
        <CareerSetupPanel
          savedBuilds={loadJSON(LS_SAVED_BUILDS, [])}
          currentPicks={Object.keys(picks).length === ATTRS.length ? picks : null}
          currentName={name}
          currentDivision={lockedDivision}
          currentMode={mode}
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
              lastPick={lastPick}
              newestSlotKey={newestSlotKey}
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

              {/* Shown once, in place, the first time a player actually
                  hits round 1 -- not front-loaded into a tutorial wall
                  before they've seen anything. Covers exactly what the
                  audit found unexplained: the round mechanic, tier colors
                  (skipped in Blind, where there's nothing to color), and
                  respins (skipped in seeded modes, where none exist). */}
              {!isRolling && round === 1 && !seenDraftHint && (
                <div className="daily-note draft-hint">
                  <span className="draft-hint-text">
                    <Sparkles size={12} />
                    Pick one fighter each round to lend their {currentAttr.label} rating to your build.
                    {!blind && " Card color shows the rating tier, bronze to legendary."}
                    {!isSeeded && " Wrong era or attribute? Each can be re-rolled once, below."}
                  </span>
                  <button
                    className="hint-dismiss"
                    aria-label="Dismiss hint"
                    onClick={() => { setSeenDraftHint(true); saveJSON(LS_SEEN_DRAFT_HINT, true); }}
                  >
                    ✕
                  </button>
                </div>
              )}
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

              {/* Replaces the old generic "Locking in next round..." message
                  -- this was the single biggest feedback gap in the draft:
                  the exact moment the selected cards disappear, the player
                  used to lose all reference to what they just picked. Now
                  it confirms FIGHTER SELECTED -> ATTRIBUTE INHERITED ->
                  ADDED TO MY BUILD using lastPick, the same state TapeCard
                  reads, so the two can never disagree. Blind omits the
                  rating line entirely (not even "?") -- a lock-in
                  confirmation communicates success, not a hidden value. */}
              {isRolling ? (
                <div className="rolling-box lock-in-box">
                  <RotateCw size={16} className="spin-icon" />
                  {lastPick && (
                    <>
                      <div className="lock-in-label mono">{ATTR_BY_KEY[lastPick.key].label.toUpperCase()} LOCKED</div>
                      {!blind && <div className="lock-in-value display">{lastPick.value.display}</div>}
                      <div className="lock-in-via mono">via {lastPick.value.fighter}</div>
                    </>
                  )}
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

      {/* The anticipation beat between the final pick and the reveal --
          reuses the exact "Rolling..." interstitial language the draft
          itself already uses for every other round transition, so this
          reads as a natural extension of it rather than a new animation
          system. Brief on purpose: it's the moment the game is processing
          the fighter just built, not a loading screen. */}
      {phase === "draftDone" && goatScore !== null && revealPending && (
        <div className="panel">
          <div className="rolling-box">
            <RotateCw size={26} className="spin-icon" />
            <div className="rolling-label mono">Locking in your build&hellip;</div>
          </div>
        </div>
      )}

      {phase === "draftDone" && goatScore !== null && !revealPending && (
        <>
          <div className="panel result-hero-panel">
            <div className="result-eyebrow mono">YOUR FIGHTER</div>
            <div className="result-fighter-name display">{name}</div>
            {blind ? (
              <BlindGoatReveal score={goatScore} reducedMotion={reducedMotion} />
            ) : (
              <div className="result-goat-num display"><AnimatedGoatScore score={goatScore} reducedMotion={reducedMotion} /></div>
            )}
            <div className="result-goat-lbl mono">GOAT SCORE</div>
            <div className="result-axis-question">How complete is this fighter?</div>
            <div className={`tier-badge result-tier-badge ${goatTier} reveal-stagger reveal-delay-1`}>
              <TierIcon cls={goatTier} size={13} />
              {goatTier === "tier-legend" ? "LEGENDARY BUILD" : goatTier === "tier-gold" ? "ELITE BUILD" : goatTier === "tier-silver" ? "SOLID BUILD" : "ROUGH BUILD"}
            </div>

            {/* Build Value is a deliberately smaller, secondary callout --
                not a second hero number -- so it never reads as "a second
                overall rating." It answers a different question than GOAT
                Score (completeness): how dangerous this specific build's
                offense actually is, derived from the same combat model
                that drives real fights (see computeBuildValueBreakdown).
                Analytical only -- never feeds back into the fight engine. */}
            <div className="build-value-callout reveal-stagger reveal-delay-1">
              <Flame size={16} />
              <div className="build-value-num mono">{buildValueInfo.buildValue}</div>
              <div className="build-value-text">
                <div className="build-value-lbl">BUILD VALUE</div>
                <div className="result-axis-question">How dangerous is this fighter's actual game?</div>
              </div>
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

            {/* "Build Qualities" -- audited and confirmed purely descriptive
                (see synergiesFor in scoring.js): restates what the
                underlying attributes already do, grants nothing itself.
                Styled as informational analysis (.build-quality-chip), not
                as an unlocked bonus -- no Sparkles, no brass/bonus tint. */}
            {synergiesFor(picks).length > 0 && (
              <div className="synergy-block">
                <div className="decision-group-label" style={{ margin: "14px 0 6px" }}>Build Qualities</div>
                {synergiesFor(picks).map((s) => (
                  <div className="build-quality-chip" key={s.label}>
                    <b>{s.label}</b> &mdash; {s.desc}
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

            {/* Closes the loop the welcome banner opens on Home: Build -> this
                reveal (Discover) -> here, told explicitly where a finished
                fighter can go next. Reuses .note-txt, the same style as the
                disclaimer line already below this panel. */}
            <div className="note-txt" style={{ marginTop: 16, marginBottom: -4 }}>
              This is your fighter now. Save the build, take it into Career, or push it further in The Lab.
            </div>

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
              {/* The Lab always opens to its own normal empty state here --
                  it has no prop path today for preloading an in-memory,
                  not-yet-saved build (it only loads from Saved Builds/
                  Legacy history in storage), and The Lab is frozen for this
                  pass, so that isn't being added now. Save Build first,
                  then pick it up from "Load a Saved Build" in the Lab. */}
              <button className="btn btn-ghost full-span" onClick={() => setPhase("lab")}>
                <FlaskConical size={16} /> Test in The Lab
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
        <div className={`panel sim-panel ${careerTab === "career" && !spotlightFightId && !careerState.pendingMilestone && (!careerState.pendingDecision || careerState.pendingDecision.type === "preFight") ? "has-advance-bar" : ""}`}>
          <div className="sim-head">
            <div>
              <div className="tagline mono" style={{ marginBottom: 2 }}>{name} &middot; {careerState.displayOverall} OVR</div>
              <div className="mono" style={{ fontSize: 14, fontWeight: 600 }}>{careerState.record.w}{"–"}{careerState.record.l}</div>
              <div className="sim-rank">{rankLabel(careerState.playerRank, careerState.champion)}</div>
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

          {/* Season-at-a-glance: "how is THIS year going" used to mean
              either a trip to the Camp tab (for the plan) or scrolling/
              counting the timeline yourself (for the record) -- everyone
              always sees the answer here now, on every tab, not just
              Career's own. Sits above the tab switch on purpose. */}
          {!careerState.finished && (
            <div className="season-glance">
              <div className="season-glance-row">
                <span className="season-glance-lbl">This Season</span>
                <span className="season-glance-record mono">{thisYearWins}-{thisYearLosses}</span>
              </div>
              {lastCampPlan && (
                <div className="season-glance-camp">
                  {lastCampPlan.campQuality === "full" ? "Full camp" : "Short notice"} &middot; {lastCampPlan.stance === "standup" ? "Stand-Up" : lastCampPlan.stance === "ground" ? "Ground" : "Balanced"}
                  {lastCampPlan.focusAttr ? ` · focused on ${ATTR_BY_KEY[lastCampPlan.focusAttr].label}` : ""}
                </div>
              )}
              <div className="season-glance-remaining mono">
                {careerState.pendingDecision && careerState.pendingDecision.type === "campPlanning"
                  ? "Planning next camp…"
                  : careerState.fightsRemainingThisYear > 0
                    ? `${careerState.fightsRemainingThisYear} fight${careerState.fightsRemainingThisYear === 1 ? "" : "s"} remaining this year`
                    : null}
              </div>
            </div>
          )}

          {/* Bottom tab nav (see the fixed bar below) splits the sim screen
              into four views. Decision-first still holds within each: a
              fight-week decision surfaces right on the Career hub, and camp
              planning gets its own tab instead of sharing this one -- an
              auto-switch effect (and a badge on the tab button) makes sure
              neither is ever missed just because the player was elsewhere. */}
          {careerTab === "career" && (
          <>
          {/* The fight that was just committed, spotlighted right here
              instead of only living at the bottom of the history feed --
              same FightResultCard the timeline itself uses below, just
              filtered out of that list (see the timeline .filter below)
              while it's spotlighted so it isn't shown twice at once. Shown
              unconditionally on spotlightFightId -- NOT gated on
              pendingDecision -- so a same-fight pendingDecision (contract
              negotiation on the Contender Series win -> Premier fight,
              chiefly) can never suppress it the way it used to. Required
              order is spotlight -> milestone -> pending decision -> normal
              flow; see the milestone block and the wrapped decision
              cluster below for the rest of that sequencing. */}
          {spotlightFightId && (() => {
            const spotlightEntry = careerState.timeline.find((e) => e.id === spotlightFightId);
            if (!spotlightEntry) return null;
            return (
              <>
                <FightResultCard e={spotlightEntry} playerName={name} />
                {/* Mic Time -- an optional post-fight beat, not a blocking
                    decision: the targets are read straight off the fight
                    entry's own micTimeTargets (computed once in commitFight,
                    never re-derived here). Tapping a target just highlights
                    it -- it stays lit until Continue below, which is the
                    real commit point (see handleAdvance): a target selected
                    books the callout, nothing selected is the decline path.
                    Tapping the same target again clears the pick.
                    Grid + self-contained scroll (mic-time-targets) so this
                    panel never inherits scroll position from the long
                    FightResultCard above it -- capped at 3 targets, so the
                    scroll container is a safety net, not the normal case. */}
                {spotlightEntry.micTimeTargets && spotlightEntry.micTimeTargets.length > 0 && (() => {
                  const circuitShort = clfTier(spotlightEntry.circuitTier).short;
                  return (
                  <div className="mic-time-panel">
                    <div className="mic-time-eyebrow mono"><Mic size={13} /> MIC TIME</div>
                    <div className="mic-time-line">The cage-side interviewer hands you the microphone.</div>
                    <div className="mic-time-prompt mono">WHO DO YOU WANT NEXT?</div>
                    <div className="mic-time-targets">
                      {spotlightEntry.micTimeTargets.map((t) => {
                        const isSelected = selectedTarget && selectedTarget.targetId === t.fighterId;
                        return (
                          <button
                            className={`mic-time-target ${isSelected ? "selected" : ""}`}
                            key={t.fighterId}
                            onClick={() => handleSelectMicTimeTarget("callout", t.fighterId, t.name)}
                          >
                            <span className="mic-time-target-rank mono">{circuitShort} &middot; {t.rank ? `#${t.rank}` : "UNRANKED"}</span>
                            <span className="mic-time-target-name">{t.name}</span>
                            <span className="mic-time-target-rec mono">{t.record.w}-{t.record.l} &middot; {t.overall} OVR</span>
                            {t.archetype && <span className="mic-time-target-archetype">{t.archetype}</span>}
                            {isSelected && <span className="target-selected-badge mono">SELECTED</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  );
                })()}
                <button className="btn btn-primary full-span" onClick={handleAdvance} style={{ marginBottom: 14 }}>
                  {selectedTarget ? <>Confirm Callout &amp; Continue</> : <>Continue</>} <ChevronRight size={16} />
                </button>
              </>
            );
          })()}
          {/* Career Milestone -- "this happened, acknowledge it," distinct
              from a pendingDecision ("what do you choose"). Only shown
              once the spotlight above has been dismissed, and always
              before whatever pendingDecision (contract negotiation, most
              notably) the same fight-commit may also have set. Reuses the
              existing promotion-card look (History's circuitMove card) --
              same up/down border treatment and tier-ramp accent, just
              blocking here with its own acknowledge button instead of
              sitting passively in a scroll feed. */}
          {!spotlightFightId && careerState.pendingMilestone && (() => {
            const m = careerState.pendingMilestone;
            const copy = MILESTONE_COPY[`${m.from}->${m.to}`];
            if (!copy) return null; // defensive only -- every real transition has copy
            const t = clfTier(m.to);
            return (
              <div className={`promotion-card milestone-live ${m.promoted ? "up" : "down"}`}>
                <div className="promotion-eyebrow mono">
                  {m.promoted ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                  {copy.eyebrow}
                </div>
                {copy.showTitle && <div className="milestone-subtitle">{copy.title}</div>}
                <div className={`promotion-tier display ${tierRampCls(m.to)}`}>{copy.tierLabel || t.short}</div>
                <div className="promotion-blurb">{copy.blurb}</div>
                {copy.showTransition && <div className="promotion-from mono">{clfTier(m.from).short} &rarr; {clfTier(m.to).short}</div>}
                <button className="btn btn-primary full-span milestone-cta" onClick={handleAcknowledgeMilestone}>{copy.cta}</button>
              </div>
            );
          })()}
          {!spotlightFightId && !careerState.pendingMilestone && (
          <>
          {careerState.pendingDecision && careerState.pendingDecision.type === "fightChoice" && (() => {
            const circuitShort = clfTier(careerState.circuitTier).short;
            return (
            <div className="decision-panel">
              <div className="decision-title"><Target size={15} /> Matchmaking Options</div>
              <div className="decision-sub">The promotion offers you a choice for the next booking &mdash; pick who you fight.</div>
              <div className="matchmaker-grid">
                {(careerState.pendingDecision.options || []).map((opt) => {
                  const meta = MATCHMAKER_TAG_META[opt.tag];
                  // A truthful empty state -- no candidate qualified, so
                  // nothing is booked here. Never substitutes an unranked
                  // or bad-form fighter to fill the card.
                  if (!opt.available) {
                    const unavailable = MATCHMAKER_UNAVAILABLE_META[opt.tag];
                    return (
                      <div className={`matchmaker-card tag-${opt.tag} unavailable`} key={opt.tag}>
                        <div className="matchmaker-tag mono">{meta.label}</div>
                        <div className="matchmaker-unavailable-title">{unavailable.title}</div>
                        <div className="matchmaker-sub">{unavailable.blurb}</div>
                      </div>
                    );
                  }
                  const wins = opt.recentForm.filter((r) => r === "W").length;
                  const losses = opt.recentForm.length - wins;
                  return (
                    <button
                      key={opt.fighterId}
                      className={`matchmaker-card tag-${opt.tag}`}
                      onClick={() => handleFightChoice(opt.tag, opt.fighterId)}
                    >
                      <div className="matchmaker-tag mono">{meta.label}</div>
                      <div className="matchmaker-name">{opt.name}</div>
                      <div className="matchmaker-archetype mono">{opt.archetype}</div>
                      <div className="matchmaker-form-row">
                        <span className="matchmaker-form-label mono">LAST 5</span>
                        <div className="matchmaker-form-pips">
                          {opt.recentForm.length > 0
                            ? opt.recentForm.map((r, i) => (
                              <span key={i} className={`form-pip ${r === "W" ? "win" : "loss"}`}>{r}</span>
                            ))
                            : <span className="matchmaker-form-empty mono">DEBUT</span>}
                        </div>
                        {opt.recentForm.length > 0 && <span className="matchmaker-form-ratio mono">{wins}-{losses}</span>}
                      </div>
                      <div className="matchmaker-meta mono">
                        {circuitShort} &middot; {opt.rank === 0 ? "CHAMPION" : opt.rank ? `#${opt.rank}` : "UNRANKED"} &middot; {opt.record.w}-{opt.record.l} &middot; {opt.overall} OVR
                      </div>
                      <div className="matchmaker-sub">{meta.sub}</div>
                    </button>
                  );
                })}
                {/* Gated on the real division ladder (playerRank), not the
                    hidden rankPoints momentum value -- these cash in an
                    ACTUAL ranked standing, so they need to track the same
                    ladder the Rankings tab shows, same as the automatic
                    title-shot gate in prepareFight. */}
                {!careerState.champion && careerState.playerRank != null && careerState.playerRank <= 3 && (
                  <button className="choice-btn danger" onClick={() => handleFightChoice("demandShot")}>Demand the Title Shot<span>Cash in the ranking, fight for the belt now</span></button>
                )}
                {!careerState.champion && careerState.playerRank != null && careerState.playerRank <= 10 && (
                  <button className="choice-btn danger" onClick={() => handleFightChoice("shortNoticeTitle")}>Short-Notice Title<span>Extremely risky, huge reward</span></button>
                )}
              </div>
              {/* Normal contender callouts are earned, not available from
                  the start -- single source of truth in hasCalloutAccess
                  (career.js): National only once genuinely Top 15 there,
                  Premier unconditionally, Regional/Contender Series never.
                  Before that, Mic Time (post-fight, a believable scoped
                  pool) is the only callout route. */}
              {careerState.divisionRoster && hasCalloutAccess(careerState.circuitTier, careerState.playerRank) && (
                <>
                  <button className="btn btn-ghost callout-toggle" onClick={() => setCalloutOpen((v) => !v)}>
                    <Megaphone size={14} /> {calloutOpen ? "Hide the Roster" : "Call Out a Contender"}
                  </button>
                  {/* Grid of compact cards in a self-contained scroll box
                      (unchanged max-height from before this pass) -- own
                      dedicated classes rather than the shared rank-num/
                      rank-name/rank-rec spans, which the Rankings tab's
                      horizontal rows still rely on unmodified. Single tap
                      still books immediately, same as before. */}
                  {calloutOpen && (
                    <div className="callout-list">
                      {careerState.divisionRoster.filter((f) => !f.isChampion).slice(0, DIVISION_SIZE).map((f, i) => (
                        <button className="callout-row" key={f.id} onClick={() => handleFightChoice("callout", f.id)}>
                          <span className="callout-card-rank mono">{circuitShort} &middot; #{i + 1}</span>
                          <span className="callout-card-name">{f.name}</span>
                          <span className="callout-card-meta mono">{f.record.w}-{f.record.l} &middot; {f.overall} OVR</span>
                          {f.archetype && <span className="callout-card-archetype">{f.archetype}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            );
          })()}
          {careerState.pendingDecision && careerState.pendingDecision.type === "trainingEvent" && (
            <div className="decision-panel">
              <div className="decision-title"><Target size={15} /> Training Camp</div>
              <div className="decision-sub">Your coaches see a real weakness in {ATTR_BY_KEY[careerState.pendingDecision.attr].label}.</div>
              <div className="choice-row">
                <button className="choice-btn" onClick={() => handleTrainingEvent(true)}>Address It<span>Small permanent gain, costs a sliver of your sharpest attributes</span></button>
                <button className="choice-btn" onClick={() => handleTrainingEvent(false)}>Stay the Course<span>Sharpens your best weapon for the next fight only</span></button>
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
          {careerState.pendingDecision && careerState.pendingDecision.type === "offCycleEvent" && (
            <div className="decision-panel">
              <div className="decision-title"><Megaphone size={15} /> Off-Cycle Content</div>
              <div className="decision-sub">Not tied to a fight -- just what's on the calendar this week.</div>
              <div className="choice-row">
                <button className="choice-btn" onClick={() => handleOffCycleEvent("mediaDay")}>Media Day<span>Big fame gain, small permanent cost to your weakest attribute</span></button>
                <button className="choice-btn" onClick={() => handleOffCycleEvent("charityWork")}>Charity Work<span>Smaller fame gain, no cost at all</span></button>
              </div>
            </div>
          )}
          {careerState.pendingDecision && careerState.pendingDecision.type === "weightMoveOffer" && (
            <div className="decision-panel">
              <div className="decision-title">
                {careerState.pendingDecision.direction === "up" ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
                {" "}Weight Class Change
              </div>
              <div className="decision-sub">
                Your team thinks a move {careerState.pendingDecision.direction} to {careerState.pendingDecision.targetDivision} could pay off. It's your call.
              </div>
              <div className="choice-row">
                <button className="choice-btn danger" onClick={() => handleWeightMoveOffer(true)}>
                  Make the Move<span>New division, fresh Top 15, back to Unranked -- rank and rankPoints don't carry over</span>
                </button>
                <button className="choice-btn" onClick={() => handleWeightMoveOffer(false)}>
                  Stay in {careerState.division}<span>Keep your ranking and everything you've built here</span>
                </button>
              </div>
            </div>
          )}
          {careerState.pendingDecision && careerState.pendingDecision.type === "contractNegotiation" && (
            <div className="decision-panel contract-panel">
              <div className="decision-title"><FileSignature size={15} /> You've Made Premier</div>
              <div className="decision-sub">The promotion wants you signed. Pick the deal that fits how you fight.</div>
              <div className="contract-option-list">
                {CONTRACT_TYPES.map((c) => (
                  <button className="contract-option" key={c.id} onClick={() => handleContractNegotiation(c.id)}>
                    <div className="contract-option-name">{c.label}</div>
                    <div className="contract-option-desc">{c.desc}</div>
                    <div className="contract-option-terms mono">Base ${c.base}K &middot; Win +${c.winBonus}K &middot; Finish +${c.finishBonus}K &middot; Fame cut {Math.round(c.fameCut * 100)}%</div>
                  </button>
                ))}
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
              {/* Contender Series is a one-fight showcase, not another
                  normal booking -- the stakes need to be visible up front,
                  not buried in the fight-week line below. */}
              {careerState.pendingFight.isContenderSeriesFight && (
                <div className="cs-stakes-strap">
                  <div className="cs-stakes-title mono"><Zap size={14} /> CONTENDER SERIES SHOWCASE</div>
                  <div className="cs-stakes-row">
                    <div className="cs-stakes-item win">
                      <div className="cs-stakes-label mono">WIN</div>
                      <div className="cs-stakes-value">CLF PREMIER CONTRACT</div>
                    </div>
                    <div className="cs-stakes-item loss">
                      <div className="cs-stakes-label mono">LOSS</div>
                      <div className="cs-stakes-value">RETURN TO NATIONAL</div>
                    </div>
                  </div>
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
          </>
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

          {/* Contender Series has no ladder of its own -- divisionRoster
              here is the National roster, deliberately carried over rather
              than rebuilt (see career.js), NOT a Contender Series
              standing. Showing it as if it were current-tier rankings is
              exactly the "#5 turned out to mean something else" confusion
              from the playtest -- a plain note instead, no roster list. */}
          {careerState.divisionRoster && careerState.circuitTier === "CLF Contender Series" && (
            <div className="cs-no-ladder-note">
              <div className="cs-no-ladder-title mono">CONTENDER SERIES</div>
              <div className="cs-no-ladder-line">No active ladder. Your National standing is preserved if you return.</div>
            </div>
          )}
          {careerState.divisionRoster && careerState.circuitTier !== "CLF Contender Series" && (
            <details className="rankings-details">
              <summary>{clfTier(careerState.circuitTier).short} Rankings</summary>
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
          {groupTimelineNewestYearFirst(careerState.timeline.filter((e) => e.id !== spotlightFightId)).map((e) => {
            if (e.type === "year") return <div className="year-divider" key={e.id}>Year {e.year}</div>;
            if (e.type === "campPlan") {
              const stanceLabel = e.stance === "standup" ? "Stand-Up" : e.stance === "ground" ? "Ground" : "Balanced";
              const showLeap = e.year >= 3 && e.year <= 5;
              // rankPoints alone resets to 0 on every tier promotion, so a
              // player who just broke into National or Premier -- the real
              // leap -- would otherwise read as "still waiting" the moment
              // their fresh climb starts back at zero. Already being out of
              // Regional (or holding a title) counts as the leap on its own;
              // short of that, fall back to real momentum inside the current
              // tier's own ladder.
              const madeTheLeap = e.champion || (e.circuitTier && e.circuitTier !== "CLF Regional") || (e.rankSnapshot != null && e.rankSnapshot <= 10);
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
              const tierMoved = e.tierBefore && e.tierAfter && e.tierBefore !== e.tierAfter;
              return (
                <div className="year-end-card" key={e.id}>
                  <div className="year-end-title">Year {e.year} Recap</div>
                  <div className="summary-row"><span>Record</span><b>{e.wins}-{e.losses}</b></div>
                  {tierMoved && (
                    <div className="summary-row"><span>Circuit Level</span><b>{clfTier(e.tierBefore).short} → {clfTier(e.tierAfter).short}</b></div>
                  )}
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
                  <Crown size={15} />
                  {e.interimName
                    ? `Title vacated while sidelined — ${e.interimName} wins the interim belt. Beat them to reclaim it for real.`
                    : "Title vacated while sidelined — the promotion books an interim title fight."}
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
                    ? `Camp addresses the ${ATTR_BY_KEY[e.attr].label} weakness — a small permanent gain, at the cost of a sliver of your two sharpest attributes.`
                    : `Coaches flagged a ${ATTR_BY_KEY[e.attr].label} weakness, but camp stayed the course — rhythm intact, best weapon sharpened for the next walkout.`}
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
                <div className="event-card bad" key={e.id}>
                  {e.direction === "up" ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
                  {/* A real division change now, not flavor text -- new
                      weight class, fresh roster, back to Unranked there. */}
                  Moving {e.direction} to {e.division} — a new division means a fresh Top 15 and starting back at Unranked, plus a short physical adjustment period.
                </div>
              );
            }
            if (e.type === "weightMoveDeclined") {
              return (
                <div className="event-card" key={e.id}>
                  <Megaphone size={15} />
                  Stayed in {e.division} -- the team's suggestion to change weight classes went nowhere.
                </div>
              );
            }
            if (e.type === "coachAssigned") {
              return (
                <div className="event-card good" key={e.id}>
                  <GraduationCap size={15} />
                  {e.name} signs on as your {ATTR_BY_KEY[e.specialty].label} coach.
                </div>
              );
            }
            if (e.type === "coachLevelUp") {
              return (
                <div className="event-card good" key={e.id}>
                  <GraduationCap size={15} />
                  Coach {e.name} hits Level {e.level} -- the relationship is paying off.
                </div>
              );
            }
            if (e.type === "offCycleEvent") {
              return (
                <div className="event-card" key={e.id}>
                  <Megaphone size={15} />
                  {e.choice === "mediaDay"
                    ? `Media day -- full showman mode, fame up to ${e.fameAfter}.`
                    : `Charity work in the community -- fame up to ${e.fameAfter}.`}
                </div>
              );
            }
            if (e.type === "contractSigned") {
              return (
                <div className="event-card good" key={e.id}>
                  <FileSignature size={15} />
                  You sign the {e.label} -- your first real Premier contract.
                </div>
              );
            }
            if (e.type === "summary") {
              return (
                <div className="summary-card" key={e.id}>
                  <div className="summary-title">Career Complete — Legacy Finalized</div>
                  <div className="summary-row"><span>Finish rate</span><b>{e.finishRate}%</b></div>
                  <div className="summary-row"><span>Strength of schedule</span><b>{e.strengthOfSchedule} avg opp</b></div>
                  <div className="summary-row"><span>Peak ranking</span><b>{rankLabel(e.peakPlayerRank, e.peakPlayerRank === 0)}</b></div>
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
            <>
              {/* The circuit ladder -- explains the whole tier system at a
                  glance instead of leaving it to be inferred from the odd
                  promotion banner. Only the CURRENT tier gets a real roster
                  below; earlier/later tiers are shown by blurb only -- each
                  one gets its own fresh champion + Top 15 + prospects the
                  moment you actually arrive there, not before, so there's
                  nothing real to preview for a tier you haven't reached. */}
              <div className="circuit-ladder">
                <div className="circuit-ladder-title">The Climb</div>
                <div className="circuit-ladder-steps">
                  {CLF_TIERS.map((t, i) => {
                    const currentIdx = CLF_TIERS.findIndex((ct) => ct.name === careerState.circuitTier);
                    const status = i === currentIdx ? "current" : i < currentIdx ? "cleared" : "locked";
                    return (
                      <div className={`circuit-step ${status} ${tierRampCls(t.name)}`} key={t.name}>
                        <div className="circuit-step-num mono">{i + 1}</div>
                        <div className="circuit-step-body">
                          <div className="circuit-step-name">{t.short}</div>
                          <div className="circuit-step-blurb">{t.blurb}</div>
                          {status === "current" && <div className="circuit-step-here mono">YOU ARE HERE</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="circuit-next">
                  <span className="circuit-next-label mono">NEXT</span>
                  {circuitNextRequirement(careerState.circuitTier, careerState.champion)}
                </div>
                <div className="circuit-note">
                  Regional, National, and Premier each run their own independent roster --
                  a champion, a ranked Top 15, and a deeper pool of prospects below them,
                  all fighting for position while you're away. Contender Series is a single
                  showcase fight against another prospect, not a ladder of its own.
                </div>
              </div>

            {careerState.circuitTier === "CLF Contender Series" ? (
              <div className="cs-no-ladder-note">
                <div className="cs-no-ladder-title mono">CONTENDER SERIES</div>
                <div className="cs-no-ladder-line">No active ladder. Your National standing is preserved if you return.</div>
              </div>
            ) : (
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
            </>
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
                { num: rankLabel(careerState.peakPlayerRank, careerState.peakPlayerRank === 0), lbl: "Peak Ranking" },
                { num: careerState.statementWins, lbl: "Statement Wins" },
                { num: careerState.rivalryWins, lbl: "Rivalries Won" },
                { num: careerState.runningLegacy, lbl: "Legacy Score" },
                { num: formatPurse(careerState.purse), lbl: "Career Earnings" },
                { num: careerState.fame, lbl: "Fame" },
              ].map((s) => (
                <div className="stat-box" key={s.lbl}>
                  <div className="stat-num">{s.num}</div>
                  <div className="stat-lbl">{s.lbl}</div>
                </div>
              ))}
            </div>
          )}

          {careerTab === "camp" && (
            <>
            {careerState.coach && (
              <div className="coach-card">
                <div className="coach-card-head">
                  <GraduationCap size={16} />
                  <div>
                    <div className="coach-name">{careerState.coach.name}</div>
                    <div className="coach-specialty mono">{ATTR_BY_KEY[careerState.coach.specialty].label} Coach &middot; Level {careerState.coach.level}</div>
                  </div>
                </div>
                <div className="coach-xp-track">
                  <div className="coach-xp-fill" style={{ width: `${careerState.coach.level >= 5 ? 100 : Math.round((careerState.coach.xp % 60) / 60 * 100)}%` }} />
                </div>
                <div className="coach-hint">Focus {ATTR_BY_KEY[careerState.coach.specialty].label} in camp to build the relationship faster -- a maxed-out coach adds +5 to that focus bonus.</div>
              </div>
            )}
            {careerState.pendingDecision && careerState.pendingDecision.type === "campPlanning" ? (
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
            )}
            </>
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
              Best Year: Year <b style={{ color: "var(--brass)" }}>{summary.peakYearNumber}</b> (+{summary.peakYearLegacy} Legacy) &middot; {summary.yearsActive} {summary.yearsActive === 1 ? "Year" : "Years"} Active
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
              { num: rankLabel(careerState.peakPlayerRank, careerState.peakPlayerRank === 0), lbl: "Peak Ranking" },
              { num: careerState.statementWins, lbl: "Statement Wins" },
              { num: careerState.rivalryWins, lbl: "Rivalries Won" },
              { num: `${careerState.record.w}-${careerState.record.l}`, lbl: "Record" },
              { num: `$${careerState.purse}K`, lbl: "Career Earnings" },
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

          {/* Just one way back to Home down here -- the top-nav Home icon
              (always visible whenever phase !== "home") already covers the
              other case, so a second Home button in this row was pure
              duplication on every single career verdict screen. */}
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
          </div>
        </div>
        );
      })()}
    </div>
  );
}
