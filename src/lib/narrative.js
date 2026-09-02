// =========================================================================
//  FIGHT NARRATIVE: an interpretation layer, strictly downstream of the sim
// =========================================================================
// Reads the round-by-round data simulateRounds already produces (see
// career.js) and turns it into short, readable prose. Nothing in this file
// decides who wins a round, who wins the fight, how much damage lands, or
// whether a finish happens -- all of that is already decided by the time
// anything here runs. This module only explains, in plain language, a
// result that already exists.
//
// The one hard rule everything below is built around: round.playerWon is
// always the ground truth for that round. Every other signal (output gap,
// sig-strike differential, takedown count, cumulative damage, fatigue) is
// only used to explain WHY that round went the way it did -- a signal is
// never eligible to pick the framing unless its own direction agrees with
// the real outcome. A fighter can out-strike or out-takedown their
// opponent in a round they still lose (round-win is its own probabilistic
// roll, not simply "whoever had the better output"), and the narrative
// must never claim otherwise.
//
// Language is deliberately conservative: OBSERVED DATA -> CONSERVATIVE
// INTERPRETATION -> NARRATIVE, never OBSERVED DATA -> DRAMATIC ASSUMPTION
// -> NARRATIVE. A modest signal gets modest language ("his output is
// starting to drop"); only a genuinely large, sustained signal earns
// stronger language ("visibly gassed").

function pick(rng, ...opts) { return opts[Math.floor(rng() * opts.length)]; }

// ---- Running story state, advanced one round at a time ---------------------
// Lets later rounds reference the arc of the fight (repeating the same beat,
// self-comparison fatigue trends, "best round so far") without needing to
// re-scan every prior round each time.
function initFightStoryState() {
  return {
    outputGapHistory: [], playerSigHistory: [], oppSigHistory: [],
    inDangerStreak: 0, oppInDangerStreak: 0,
    lastReasonKind: null, lastReasonWon: null,
  };
}

function advanceFightStoryState(state, round, reasonKind) {
  return {
    outputGapHistory: [...state.outputGapHistory, round.outputGap],
    playerSigHistory: [...state.playerSigHistory, round.playerSig],
    oppSigHistory: [...state.oppSigHistory, round.oppSig],
    inDangerStreak: (round.nearFinish && !round.playerWon) ? state.inDangerStreak + 1 : 0,
    oppInDangerStreak: (round.nearFinish && round.playerWon) ? state.oppInDangerStreak + 1 : 0,
    lastReasonKind: reasonKind,
    lastReasonWon: round.playerWon,
  };
}

function recentAvg(arr, n) {
  const slice = arr.slice(-n);
  return slice.length ? slice.reduce((s, v) => s + v, 0) / slice.length : 0;
}

// Scores every real, sign-matched explanation for how this round went, and
// returns the strongest one plus a short list of runners-up (used by the
// finish-round build-up, which wants the top explanation without the
// terminal "close round" filler).
function scoreReasons(round, prevState, isFirst) {
  const won = round.playerWon;
  const sigDiff = round.playerSig - round.oppSig;
  const tdDiff = round.playerTD - round.oppTD;
  const dmgGap = round.oppDamage - round.playerDamage; // cumulative; + favors player

  const priorAvg = prevState.outputGapHistory.length ? recentAvg(prevState.outputGapHistory, 2) : 0;
  const momentumFlipped = !isFirst && Math.sign(round.outputGap) !== 0 && Math.sign(priorAvg) !== 0
    && Math.sign(round.outputGap) !== Math.sign(priorAvg) && Math.abs(round.outputGap) > 3;

  const playerPeakSig = Math.max(0, ...prevState.playerSigHistory);
  const oppPeakSig = Math.max(0, ...prevState.oppSigHistory);
  // Two severity tiers -- see the file header. A mild dip only earns "his
  // output is starting to drop"; the stronger "visibly gassed" language is
  // reserved for a real, large, sustained drop backed by high fatigue too.
  const playerDropFrac = playerPeakSig > 0 ? 1 - round.playerSig / playerPeakSig : 0;
  const oppDropFrac = oppPeakSig > 0 ? 1 - round.oppSig / oppPeakSig : 0;
  const playerFadingMild = !isFirst && round.playerFatigue >= 0.14 && playerDropFrac >= 0.15;
  const playerFadingStrong = playerFadingMild && round.playerFatigue >= 0.28 && playerDropFrac >= 0.30;
  const oppFadingMild = !isFirst && round.oppFatigue >= 0.14 && oppDropFrac >= 0.15;
  const oppFadingStrong = oppFadingMild && round.oppFatigue >= 0.28 && oppDropFrac >= 0.30;

  const allGapsSoFar = [...prevState.outputGapHistory, round.outputGap];
  const isBestGapForPlayer = round.outputGap > 0 && round.outputGap === Math.max(...allGapsSoFar);
  const isBestGapForOpp = round.outputGap < 0 && round.outputGap === Math.min(...allGapsSoFar);
  const lateSurge = round.round >= 3 && (isBestGapForPlayer || isBestGapForOpp);

  const reasons = [];
  if (tdDiff !== 0 && (tdDiff > 0) === won) reasons.push({ kind: "takedown", score: 20 + Math.abs(tdDiff) * 5 });
  if (round.groundHeavy && Math.abs(dmgGap) >= 6 && (dmgGap > 0) === won) reasons.push({ kind: "grapplingControl", score: 10 + Math.abs(dmgGap) });
  if (lateSurge && (round.outputGap > 0) === won) reasons.push({ kind: "surge", score: 15 + Math.abs(round.outputGap) });
  if (momentumFlipped && (round.outputGap > 0) === won) reasons.push({ kind: "momentum", score: 8 + Math.abs(round.outputGap) });
  if ((playerFadingStrong && !won) || (oppFadingStrong && won)) reasons.push({ kind: "fatigueStrong", score: 12 });
  else if ((playerFadingMild && !won) || (oppFadingMild && won)) reasons.push({ kind: "fatigueMild", score: 7 });
  if (Math.abs(sigDiff) >= 8 && (sigDiff > 0) === won) reasons.push({ kind: "striking", score: Math.abs(sigDiff) });
  // Same real-gap threshold the closing summary uses for its own "fast
  // start" read -- a round 1 that's actually a near-toss-up shouldn't
  // claim "he starts fast, aggressive" just because it happened to go one way.
  if (isFirst && Math.abs(round.outputGap) >= 6) reasons.push({ kind: "opening", score: 3 });
  reasons.push({ kind: "close", score: 0 }); // universal fallback, always sign-correct

  reasons.sort((a, b) => b.score - a.score);
  return reasons;
}

function renderReason(kind, won, repeat, rng) {
  switch (kind) {
    case "takedown":
      if (repeat) return won ? "You keep the fight on the mat and control another round from top position." : "He keeps you there and controls another round from top position.";
      return won
        ? pick(rng, "A clean takedown lets you dictate where this round happens.", "You change levels and put him on his back.")
        : pick(rng, "He changes levels and puts you on your back.", "A clean takedown drags this round to the mat, and he controls it.");
    case "grapplingControl":
      if (repeat) return won ? "You keep him there, grinding out another round in the clinch and on top." : "He keeps you there, grinding out another round against the cage.";
      return won
        ? pick(rng, "You drag the fight into prolonged grappling exchanges and start taking control of the round.", "This round lives in the clinch and on the mat, and you're winning the exchanges there.")
        : pick(rng, "He drags the fight into prolonged grappling exchanges and starts taking control of the round.", "The fight spends most of this round in the clinch and on the mat, and he's winning it there.");
    case "surge":
      return won
        ? pick(rng, "You pour on the pressure late, and it's your biggest push of the fight.", "This is your best round yet, right when it matters most.")
        : pick(rng, "He finds another gear late that you haven't seen from him all fight.", "His biggest push of the fight comes right when you needed to close it out.");
    case "momentum":
      if (repeat) return won ? "You're still finding him, building on the last round." : "He's still finding his rhythm, building on the last round.";
      return won
        ? pick(rng, "You settle in and start finding him more consistently.", "The tide turns your way -- you adjust and take this round back.")
        : pick(rng, "He adjusts and starts finding his rhythm.", "The tide turns -- he figures out an answer and takes this round.");
    // Conservative by design (see file header): a mild dip only ever gets
    // "output starting to drop." The stronger "visibly gassed" language is
    // gated well above this in scoreReasons and only reachable via
    // fatigueStrong.
    case "fatigueMild":
      return won
        ? pick(rng, "His output is starting to drop as the pace catches up with him.", "He's beginning to slow down a step.")
        : pick(rng, "Your output is starting to drop as the pace catches up with you.", "You're beginning to slow down a step.");
    case "fatigueStrong":
      return won
        ? pick(rng, "He's visibly gassed, and you keep the pace right where it hurts him.", "He's fading hard now, and you keep coming.")
        : pick(rng, "You're visibly gassed, and he's starting to take advantage.", "You're fading hard, and he senses it.");
    case "striking":
      if (repeat) return won ? "You keep landing the cleaner shots, round after round." : "He keeps landing the cleaner shots, round after round.";
      return won
        ? pick(rng, "You control the distance, landing consistently while avoiding most of his offense.", "Your volume at range is the difference, piling up clean shots.")
        : pick(rng, "He finds his rhythm on the feet and starts landing the cleaner shots.", "He picks up the pace and starts winning the striking exchanges.");
    case "opening":
      return won
        ? pick(rng, "You settle into range early and start picking your shots.", "You take the center of the cage and start setting the pace.")
        : pick(rng, "He starts fast, forcing you to give ground early.", "He comes out aggressive, and you spend the round finding your feet.");
    default: // "close"
      if (repeat) return won ? "Another close one, but you edge it again." : "Another close one that doesn't go your way.";
      return won
        ? pick(rng, "A close round, but you edge it on volume.", "Competitive action -- the cards likely lean your way here.")
        : pick(rng, "A close round that could've gone either way, narrowly against you.", "Tight action -- this one's a coin flip, and it doesn't land your way.");
  }
}

// Danger/survival framing -- tied to round.playerWon by construction in the
// sim itself (loserDamage is literally whichever side lost the round), so
// it needs no sign-matching and stays a fixed top priority.
function renderDanger(round, prevState, rng) {
  const won = round.playerWon;
  const streak = won ? prevState.oppInDangerStreak : prevState.inDangerStreak;
  if (streak >= 1) {
    return won ? "He's still in survival mode, absorbing more damage he can't afford."
                : "You're still in survival mode, doing whatever it takes to see the round out.";
  }
  return won
    ? pick(rng, "A sustained assault has him in real trouble, but he survives the round.", "He's rocked and barely hanging on as the horn saves him.")
    : pick(rng, "You're hurt and fighting to survive to the bell.", "A firefight leaves you in real danger, and you're lucky to hear the horn.");
}

// A round that actually ends the fight gets a build-up clause (same
// sign-matched reasoning as any other round, so it can't contradict what
// actually happened) plus an explicit finish clause keyed off the real
// method. This is the only place that acknowledges a finish in the
// per-round prose -- deliberately: the KO/TKO or Submission banner is its
// own separate display element, this just narrates the round honestly.
function renderFinishRound(round, prevState, method, rng) {
  const won = round.playerWon;
  const reasons = scoreReasons(round, prevState, round.round === 1).filter((r) => r.kind !== "close");
  const buildupKind = reasons.length ? reasons[0].kind : null;
  const buildup = buildupKind ? renderReason(buildupKind, won, false, rng) : null;

  const isKO = method === "KO/TKO" || method === "KO/TKO Loss";
  const finishClause = won
    ? (isKO
        ? pick(rng, "The pressure eventually breaks him, and the referee steps in.", "A clean finishing sequence ends it -- the ref jumps in before he can recover.")
        : pick(rng, "A scramble ends with the finish locked in tight, and he has no choice but to tap.", "He gets caught in deep water with no way out, and the tap comes."))
    : (isKO
        ? pick(rng, "A clean sequence catches you, and the referee steps in before you can recover.", "The pressure breaks you, and it's waved off.")
        : pick(rng, "A scramble ends with the hold locked in tight, and you have no choice but to tap.", "You get caught in deep water with no way out, and the tap comes."));

  return buildup ? `${buildup} ${finishClause}` : finishClause;
}

// ---- Public: one round's narrative text ------------------------------------
// Call once per round, in order, threading the returned state forward.
function narrateRound(round, state, method, rng = Math.random) {
  const isFirst = round.round === 1;
  let text, kind;
  if (round.finishThisRound) {
    text = renderFinishRound(round, state, method, rng);
    kind = "finish";
  } else if (round.nearFinish) {
    text = renderDanger(round, state, rng);
    kind = "danger";
  } else {
    const reasons = scoreReasons(round, state, isFirst);
    const top = reasons[0];
    const repeat = state.lastReasonKind === top.kind && state.lastReasonWon === round.playerWon;
    text = renderReason(top.kind, round.playerWon, repeat, rng);
    kind = top.kind;
  }
  return { text, nextState: advanceFightStoryState(state, round, kind) };
}

// ---- Public: fight moments (separate from round narrative) ----------------
// Standout events pulled from the whole fight: real danger, a knockdown, a
// comeback or a collapse, the finish itself. Deliberately never folded into
// the round prose above -- these are meant to stand alone, so later polish
// can give them stronger visual treatment without editing round text.
function identifyMoments(rounds, playerKD, oppKD, finishRound, method, win) {
  const moments = [];
  rounds.forEach((r) => {
    if (r.nearFinish && !r.finishThisRound) {
      moments.push({
        round: r.round, type: r.playerWon ? "danger-opp" : "danger-self",
        label: r.playerWon ? "OPPONENT ROCKED" : "IN TROUBLE",
        text: r.playerWon ? "You had him hurt and on the brink." : "You were badly hurt and fighting to survive.",
      });
    }
  });

  // A non-finish knockdown is a real, fight-level result the sim already
  // decides (see simulateRounds) -- it just isn't tied to a specific round.
  // Attributed here to whichever round had the strongest supporting output
  // gap, using language that credits the SURGE, not a claim the engine
  // recorded a knockdown in that exact round.
  if (finishRound == null && playerKD) {
    const best = [...rounds].sort((a, b) => b.outputGap - a.outputGap)[0];
    moments.push({
      round: null, type: "knockdown", label: "KNOCKDOWN",
      text: `You dropped him during your biggest offensive surge of the fight${best ? ` (Round ${best.round})` : ""}.`,
    });
  }
  if (finishRound == null && oppKD) {
    const worst = [...rounds].sort((a, b) => a.outputGap - b.outputGap)[0];
    moments.push({
      round: null, type: "knockdown-against", label: "KNOCKED DOWN",
      text: `He dropped you during his biggest offensive surge of the fight${worst ? ` (Round ${worst.round})` : ""}.`,
    });
  }

  const half = Math.ceil(rounds.length / 2);
  const earlyWins = rounds.slice(0, half).filter((r) => r.playerWon).length;
  if (win && earlyWins <= Math.floor(half / 3) && rounds.length >= 3) {
    moments.push({ round: null, type: "comeback", label: "COMEBACK", text: "Down early, you turned this fight around." });
  }
  const earlyLosses = rounds.slice(0, half).filter((r) => !r.playerWon).length;
  if (!win && earlyLosses <= Math.floor(half / 3) && rounds.length >= 3) {
    moments.push({ round: null, type: "collapse", label: "IT SLIPPED AWAY", text: "You had this fight, and it got away from you late." });
  }

  if (finishRound != null) {
    moments.push({
      round: finishRound, type: "finish", label: win ? "FIGHT-ENDING SEQUENCE" : "FIGHT OVER",
      text: win ? `You end it -- ${method} in round ${finishRound}.` : `It's over -- ${method.replace(" Loss", "")} in round ${finishRound}.`,
    });
  }
  return moments;
}

// ---- Public: closing "how it happened" summary -----------------------------
function howItHappened(rounds, win, method, finishRound) {
  const parts = [];
  const first = rounds[0];
  if (first.outputGap > 6 && first.playerWon) parts.push("You started fast and never really let him into the fight.");
  else if (first.outputGap < -6 && !first.playerWon) parts.push("He started faster, forcing you to adjust.");
  else parts.push("It started as an even fight, both fighters feeling each other out.");

  const earlyLeader = rounds[0].playerWon ? "player" : "opp";
  const lateHalf = rounds.slice(Math.ceil(rounds.length / 2));
  const lateLeaderWins = lateHalf.filter((r) => r.playerWon).length;
  const lateLeader = lateHalf.length
    ? (lateLeaderWins > lateHalf.length / 2 ? "player" : lateLeaderWins < lateHalf.length / 2 ? "opp" : "even")
    : earlyLeader;

  if (rounds.length >= 3 && earlyLeader !== lateLeader && lateLeader !== "even") {
    parts.push(lateLeader === "player"
      ? "Your adjustments and conditioning turned the fight around from there."
      : "Whatever advantage you had early disappeared as the fight wore on.");
  } else if (rounds.length >= 3) {
    const last = rounds[rounds.length - 1];
    if (Math.abs(last.playerFatigue - last.oppFatigue) >= 0.1) {
      parts.push(last.oppFatigue > last.playerFatigue
        ? "Your conditioning became a real factor as the fight wore on."
        : "Fatigue caught up with you in the second half.");
    }
  }

  if (finishRound != null) {
    parts.push(win ? `A finishing sequence in round ${finishRound} settled it.` : `It ended in round ${finishRound}, and the finish went against you.`);
  } else {
    parts.push(win ? "It went the distance, and the cleaner work carried the cards." : "It went the distance, and the cards didn't fall your way.");
  }
  return parts.join(" ");
}

// ---- Public: run the whole round list through narrateRound in order -------
function buildFightStory(rounds, method) {
  let state = initFightStoryState();
  const roundNarratives = rounds.map((r) => {
    const { text, nextState } = narrateRound(r, state, method);
    state = nextState;
    return text;
  });
  return roundNarratives;
}

export { buildFightStory, identifyMoments, howItHappened };
