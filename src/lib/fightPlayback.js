// =========================================================================
//  LIVE FIGHT PLAYBACK: a presentation-only derivation layer, strictly
//  downstream of the sim and of narrative.js, same as narrative.js itself
//  is strictly downstream of career.js's simulateRounds/resolveFight.
// =========================================================================
// Takes an ALREADY-COMPLETE fight result -- rounds[], roundNarratives[],
// moments[] -- and reshapes it into a round-by-round "beat script" for
// src/components/LiveFightViewer.jsx to sequence through with timed
// animation. Nothing here decides who wins a round, who wins the fight, how
// much damage lands, or whether a finish happens -- all of that is already
// decided by the time this module ever runs (see career.js:563-577). This
// file performs no randomness of its own and must never be imported by
// career.js -- the separation between "what happened" and "how it's shown"
// stays one-directional.
//
// Every value below is read straight off fields simulateRounds already
// produces (see career.js:192-201) or off narrative.js's own existing
// output -- nothing new is simulated.

import { momentumFlipped } from "./narrative.js";

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// roundProb (career.js:141) is `clamp(0.5 + outputGap/55 + ..., 0.12, 0.88)`,
// which saturates once |outputGap| crosses ~21 (0.38 * 55) -- past that
// point more output-gap magnitude no longer changes who wins the round, so
// the meter pins at the same point the engine's own probability already
// does. Kept as its own named constant rather than inlined, since it's a
// deliberate mirror of that saturation point, not an arbitrary scale.
const MOMENTUM_SATURATION_GAP = 22;

// -1..1, + favors the player. Pure passthrough of round.outputGap, rescaled
// and clamped -- invents no new value.
function momentumFor(outputGap) {
  return clamp(outputGap / MOMENTUM_SATURATION_GAP, -1, 1);
}

// 0..100, for a center-anchored tug-of-war bar (50 = dead even).
function momentumToPercent(momentum) {
  return clamp(((momentum + 1) / 2) * 100, 0, 100);
}

// Cosmetic animation-speed/glow bucket only -- never read by anything that
// could feed back into a probability, roll, or outcome.
function intensityFor(outputGap) {
  const abs = Math.abs(outputGap);
  if (abs >= 14) return "high";
  if (abs >= 6) return "medium";
  return "low";
}

// Deliberately simple, deterministic pacing -- no jitter in V1. Finish
// rounds get the longest beat (the moment the fight actually ends deserves
// the most room), near-finish rounds and momentum flips get progressively
// shorter extra beats, everything else is a flat baseline.
function beatDurationMs(beat) {
  if (beat.finishThisRound) return 2600;
  if (beat.nearFinish) return 2000;
  if (beat.flipped) return 1700;
  return 1200;
}

// Builds one Beat per round, in round order, plus the whole-fight moments
// (identifyMoments' round:null entries -- comeback/collapse/knockdown-
// without-a-finish-round) that don't attach to any single round.
//
// Beat = {
//   round, playerWon, momentum, momentumPercent, flipped, intensity,
//   nearFinish, finishThisRound, playerFatigue, oppFatigue, playerDamage,
//   oppDamage, narrative, moments,
// }
function buildPlaybackScript(rounds, roundNarratives, moments) {
  const outputGapHistory = [];
  const beats = (rounds || []).map((round, i) => {
    const isFirst = i === 0;
    const momentum = momentumFor(round.outputGap);
    const flipped = momentumFlipped(round.outputGap, outputGapHistory, isFirst);
    outputGapHistory.push(round.outputGap);
    return {
      round: round.round,
      playerWon: round.playerWon,
      momentum,
      momentumPercent: momentumToPercent(momentum),
      flipped,
      intensity: intensityFor(round.outputGap),
      nearFinish: round.nearFinish,
      finishThisRound: round.finishThisRound,
      playerFatigue: round.playerFatigue,
      oppFatigue: round.oppFatigue,
      playerDamage: round.playerDamage,
      oppDamage: round.oppDamage,
      narrative: (roundNarratives || [])[i] || "",
      moments: (moments || []).filter((m) => m.round === round.round),
    };
  });
  const fightArcMoments = (moments || []).filter((m) => m.round == null);
  return { beats, fightArcMoments };
}

export { buildPlaybackScript, momentumToPercent, beatDurationMs };
