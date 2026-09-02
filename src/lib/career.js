import { ATTRS, SKILL_KEYS, ATTR_BY_KEY, WEIGHT_CLASSES } from "../data/attrs.js";
import { clamp, slugify } from "./utils.js";
import { sfx } from "./audio.js";
import { generateOpponentNames } from "../data/fighters.js";
import {
  buildFightStory,
  identifyMoments as identifyFightMoments,
  howItHappened as summarizeHowItHappened,
} from "./narrative.js";

// =========================================================================
//  CAREER SIMULATION ENGINE
// =========================================================================
const ARCHETYPES = [
  { name: "Balanced", mult: {} },
  { name: "Striker", mult: { STRIKING: 1.15, POWER: 1.1, WRESTLING: 0.8, GRAPPLING: 0.8 } },
  { name: "Wrestler", mult: { WRESTLING: 1.2, GRAPPLING: 1.05, STRIKING: 0.85, POWER: 0.9 } },
  { name: "Submission Specialist", mult: { GRAPPLING: 1.25, CARDIO: 1.05, POWER: 0.8, WRESTLING: 0.95 } },
  { name: "Granite Grinder", mult: { CHIN: 1.2, CARDIO: 1.15, POWER: 0.85, SPEED: 0.9 } },
  { name: "Speedster", mult: { SPEED: 1.2, STRIKING: 1.05, POWER: 0.85, CARDIO: 0.95 } },
];

function generateOpponentProfile(baseRating) {
  const archetype = ARCHETYPES[Math.floor(Math.random() * ARCHETYPES.length)];
  const attrs = {};
  SKILL_KEYS.forEach((k) => {
    const mult = archetype.mult[k] || 1;
    const jitter = Math.random() * 8 - 4;
    attrs[k] = clamp(Math.round(baseRating * mult + jitter), 40, 99);
  });
  const overall = Math.round(SKILL_KEYS.reduce((s, k) => s + attrs[k], 0) / SKILL_KEYS.length);
  const traits = deriveTraits(attrs);
  // Archetype comes with a signature trait even if the rolled stats fell just short of the threshold.
  const archetypeTrait = archetype.name === "Wrestler" ? "WRESTLER"
    : archetype.name === "Submission Specialist" ? "SUB_THREAT"
    : archetype.name === "Granite Grinder" ? "IRON_CHIN"
    : archetype.name === "Striker" ? "KO_THREAT"
    : null;
  if (archetypeTrait && !traits.includes(archetypeTrait) && traits.length < 4) traits.push(archetypeTrait);
  return { attrs, overall, archetype: archetype.name, traits };
}

function applyAging(base, year, wear) {
  const PEAK_START = 2, PEAK_END = 5;
  const pastPeak = Math.max(0, year - PEAK_END);
  const prePeak = Math.max(0, PEAK_START - year);
  const decline = (ratePerYear) => pastPeak * ratePerYear + prePeak * (ratePerYear * 0.7);

  return {
    STRIKING: clamp(base.STRIKING - decline(0.5), 40, 99),
    GRAPPLING: clamp(base.GRAPPLING - decline(0.5), 40, 99),
    WRESTLING: clamp(base.WRESTLING - decline(0.7), 40, 99),
    CARDIO: clamp(base.CARDIO - decline(1.0), 40, 99),
    POWER: clamp(base.POWER - decline(2.5), 40, 99),
    CHIN: clamp(base.CHIN - decline(1.5) - wear.chin, 35, 99),
    SPEED: clamp(base.SPEED - decline(3.0) - wear.speed, 35, 99),
    IQ: clamp(base.IQ + Math.min(8, pastPeak * 0.3), 40, 99),
  };
}

// stanceBias shifts ground-time share to reflect the player's chosen gameplan
// for the year (+ground focus, -stand-up focus), on top of the natural pull
// from the Wrestling/Grappling differential.
function estimatePhaseControl(a, b, stanceBias) {
  const groundPull = (a.WRESTLING - b.WRESTLING) * 0.6 + (a.GRAPPLING - b.GRAPPLING) * 0.4;
  const groundShare = clamp(0.5 + groundPull / 150 + (stanceBias || 0), 0.12, 0.88);
  return { groundShare, standShare: 1 - groundShare };
}

function phaseWeightedOutput(a, phase) {
  const standOut = a.STRIKING * 0.65 + a.POWER * 0.35;
  const groundOut = a.GRAPPLING * 0.6 + a.WRESTLING * 0.4;
  return standOut * phase.standShare + groundOut * phase.groundShare;
}

function computeWinProbability(player, opp, phase, reachScore) {
  const offenseGap = phaseWeightedOutput(player, phase) - phaseWeightedOutput(opp, phase);
  const durabilityGap = (player.CHIN + player.CARDIO * 0.5) - (opp.CHIN + opp.CARDIO * 0.5);
  const iqGap = player.IQ - opp.IQ;
  const speedGap = player.SPEED - opp.SPEED;
  const reachGap = reachScore - 75;

  const prob = 0.5
    + offenseGap / 220
    + durabilityGap / 300
    + iqGap / 400
    + speedGap / 500
    + reachGap / 700;

  return clamp(prob, 0.08, 0.92);
}

// Multipliers tuned against real UFC finish data (~8,600 bouts): KO/TKO
// outnumbers submission roughly 63:37 among finishes. The bare formula
// below the multipliers -- POWER*STRIKING vs CHIN for KO, GRAPPLING*
// WRESTLING for submission -- structurally favors submission by about 4:1
// for evenly-matched fighters (the CHIN-resistance term alone accounts for
// most of that gap), so the multipliers correct the *ratio*, not the
// underlying stat logic.
function computeFinishOdds(attacker, defender, phase) {
  const koPotential = (attacker.POWER * attacker.STRIKING / 100) * ((100 - defender.CHIN) / 100) * phase.standShare * 6.0;
  const subPotential = (attacker.GRAPPLING * attacker.WRESTLING / 100) * phase.groundShare * 0.9;
  return { koPotential, subPotential };
}

// KO/TKO vs Submission, weighted by potential. This used to also have to
// weigh a third "Decision" outcome (hence the name), back when a single
// roll picked between all three -- now decision-vs-finish is decided
// separately, by simulateRounds' round-by-round damage threshold, so this
// is only ever called once a finish has already happened and just needs
// to know which kind.
function rollMethod(odds) {
  return Math.random() * (odds.koPotential + odds.subPotential) < odds.koPotential ? "KO/TKO" : "Submission";
}

// ---- Round-by-round simulation -------------------------------------------
// Runs the fight one round at a time instead of a single coin flip, with
// real state carried forward between rounds: CARDIO drains a fighter's
// output round over round (a gas-tank fighter fades late), and every round
// lost adds accumulated damage (POWER vs CHIN) that raises finish risk as
// the fight goes on -- a fighter who's been outstruck for two rounds is
// genuinely more finishable in the third, not just re-rolling the same odds
// blind to what already happened. A finish can land in any round; a fight
// that reaches the final round with nothing decided goes to scorecards
// tallied from the rounds actually won, not synthesized separately from the
// result the way the old single-roll model's stats were.
function simulateRounds(player, opp, phase, pMod, oMod, totalRounds) {
  let playerFatigue = 0, oppFatigue = 0; // 0-1, grows each round from CARDIO
  let playerDamage = 0, oppDamage = 0; // absorbed damage, grows from lost rounds
  let playerSig = 0, oppSig = 0, playerTD = 0, oppTD = 0;
  const rounds = [];
  let finishRound = null, finishTime = null, finishMethod = null, finishWinner = null;

  for (let r = 1; r <= totalRounds; r++) {
    playerFatigue = clamp(playerFatigue + (100 - player.CARDIO) / 480, 0, 0.4);
    oppFatigue = clamp(oppFatigue + (100 - opp.CARDIO) / 480, 0, 0.4);
    // Absorbed damage saps output too, on top of the fatigue toll -- a
    // fighter who's been hurt fights worse, not just closer to finished.
    const playerOut = phaseWeightedOutput(player, phase) * (1 - playerFatigue) * (1 - clamp(playerDamage / 260, 0, 0.35));
    const oppOut = phaseWeightedOutput(opp, phase) * (1 - oppFatigue) * (1 - clamp(oppDamage / 260, 0, 0.35));
    const roundProb = clamp(0.5 + (playerOut - oppOut) / 55 + pMod.winProbDelta - oMod.winProbDelta, 0.12, 0.88);
    const playerWonRound = Math.random() < roundProb;

    // Real UFC fighters land roughly 3.5-4.5 significant strikes per
    // minute, so ~17-22 in a 5-minute round -- this was badly under-tuned
    // (a flat "5" per round, meant to be this same rate spread across a
    // whole fight's worth of rounds, got left at a whole-fight-sized
    // number when the stats moved from a single post-hoc total into a
    // real per-round accumulation).
    const pRoundSig = Math.max(3, Math.round(phase.standShare * 50 * (player.STRIKING / 80) * (1 - playerFatigue * 0.4)));
    const oRoundSig = Math.max(3, Math.round(phase.standShare * 50 * (opp.STRIKING / 80) * (1 - oppFatigue * 0.4)));
    playerSig += pRoundSig; oppSig += oRoundSig;
    const pRoundTD = Math.round(phase.groundShare * 0.9 * (player.WRESTLING / 80));
    const oRoundTD = Math.round(phase.groundShare * 0.9 * (opp.WRESTLING / 80));
    playerTD += pRoundTD; oppTD += oRoundTD;

    // Whoever lost the round absorbs damage, scaled by the winner's power
    // and resisted by the loser's chin.
    if (playerWonRound) oppDamage += Math.max(3, (player.POWER - opp.CHIN * 0.45) / 6 + 5);
    else playerDamage += Math.max(3, (opp.POWER - player.CHIN * 0.45) / 6 + 5);

    // Finish check: only the fighter who just lost the round is at risk,
    // and only once their accumulated damage crosses a real threshold --
    // weighted by the winner's actual finish odds (same KO/sub potential
    // math the pre-fight preview and old model both used) so a low-power
    // grinder rarely finishes even a badly hurt opponent.
    let nearFinish = false, finishThisRound = false;
    const loserDamage = playerWonRound ? oppDamage : playerDamage;
    if (loserDamage >= 16) {
      nearFinish = true;
      const attacker = playerWonRound ? player : opp;
      const defender = playerWonRound ? opp : player;
      const aMod = playerWonRound ? pMod : oMod;
      const odds = computeFinishOdds(attacker, defender, phase);
      odds.koPotential += aMod.koBoost;
      odds.subPotential += aMod.subBoost;
      const finishChance = clamp((loserDamage - 12) / 85 + (odds.koPotential + odds.subPotential) / 380, 0, 0.5);
      if (Math.random() < finishChance) {
        finishThisRound = true;
        finishWinner = playerWonRound;
        finishMethod = rollMethod(odds);
        finishRound = r;
        const secs = Math.floor(Math.random() * 299) + 1;
        finishTime = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
      }
    }

    // Per-round detail for the narrative layer (see narrative.js) -- purely
    // additive: every value here was already being computed above for the
    // simulation's own use, just not previously kept past this iteration.
    // Recording it doesn't touch a single probability, roll, or threshold.
    rounds.push({
      round: r, playerWon: playerWonRound, margin: Math.abs(roundProb - 0.5),
      playerSig: pRoundSig, oppSig: oRoundSig,
      playerTD: pRoundTD, oppTD: oRoundTD,
      playerFatigue, oppFatigue, // cumulative 0-0.4, AFTER this round
      playerDamage, oppDamage,   // cumulative, AFTER this round
      outputGap: playerOut - oppOut,
      nearFinish, finishThisRound,
      groundHeavy: phase.groundShare > 0.55,
    });

    if (finishThisRound) break;
  }

  let win, method;
  if (finishRound != null) {
    win = finishWinner;
    method = win ? finishMethod : `${finishMethod} Loss`;
  } else {
    const playerRoundsWon = rounds.filter((rd) => rd.playerWon).length;
    win = playerRoundsWon > rounds.length / 2;
    method = win ? "Decision" : "Decision Loss";
  }

  let playerKD = 0, oppKD = 0;
  if (method === "KO/TKO") playerKD = 1;
  else if (method === "KO/TKO Loss") oppKD = 1;
  else {
    // A knockdown that didn't finish it -- still a real moment in a fight
    // that went the distance (or ended by submission instead).
    if (player.POWER >= 82 && Math.random() < 0.16) playerKD = 1;
    if (opp.POWER >= 82 && Math.random() < 0.16) oppKD = 1;
  }

  // Three judges reading the same real rounds, not a second independent
  // simulation -- each agrees with the actual round winner almost always,
  // and only a genuinely close round (low margin) has a real chance of
  // reading differently on one card, same as real judging splits do.
  const scorecards = finishRound == null ? [0, 1, 2].map(() => {
    let playerRoundsWon = 0;
    rounds.forEach((rd) => {
      const judgeAgrees = Math.random() < 0.82 + rd.margin * 0.7;
      if (rd.playerWon ? judgeAgrees : !judgeAgrees) playerRoundsWon++;
    });
    return { player: 10 * totalRounds - (totalRounds - playerRoundsWon), opp: 10 * totalRounds - playerRoundsWon };
  }) : null;

  const pControlShare = clamp(0.5 + (player.WRESTLING - opp.WRESTLING) / 200, 0.1, 0.9);

  return {
    win, method, rounds,
    stats: {
      totalRounds, finishRound, finishTime, scorecards,
      player: { sigStrikes: playerSig, takedowns: playerTD, controlPct: Math.round(phase.groundShare * 100 * pControlShare), knockdowns: playerKD },
      opp: { sigStrikes: oppSig, takedowns: oppTD, controlPct: Math.round(phase.groundShare * 100 * (1 - pControlShare)), knockdowns: oppKD },
    },
  };
}

// =========================================================================
//  FIGHTER TRAITS
//  Traits never replace the numeric ratings -- they're small, capped nudges
//  on top of the same engine, derived from a fighter's actual attributes so
//  they read as earned rather than random. Used sparingly (capped deltas)
//  so fights stay driven by the stats, not the traits.
// =========================================================================
const TRAIT_DEFS = {
  KO_THREAT: { label: "Knockout Threat", desc: "One punch changes everything." },
  SUB_THREAT: { label: "Submission Threat", desc: "Dangerous the moment the fight hits the mat." },
  WRESTLER: { label: "Wrestler", desc: "Dictates where the fight happens." },
  IRON_CHIN: { label: "Durable", desc: "Very hard to hurt, let alone finish." },
  PACE_SETTER: { label: "Pace Setter", desc: "Elite conditioning grinds opponents down late." },
  FAST_STARTER: { label: "Fast Starter", desc: "Explosive early, looks to end things fast." },
  COUNTER_STRIKER: { label: "Counter Striker", desc: "Patient -- lets opponents make the first mistake." },
  PRESSURE_FIGHTER: { label: "Pressure Fighter", desc: "Constant forward pressure wins close rounds." },
};

function deriveTraits(a) {
  const traits = [];
  if (a.POWER >= 85 && a.STRIKING >= 78) traits.push("KO_THREAT");
  if (a.GRAPPLING >= 83 && a.WRESTLING >= 72) traits.push("SUB_THREAT");
  if (a.WRESTLING >= 85 && !traits.includes("SUB_THREAT")) traits.push("WRESTLER");
  if (a.CHIN >= 86) traits.push("IRON_CHIN");
  if (a.CARDIO >= 87 && a.IQ >= 72) traits.push("PACE_SETTER");
  if (a.SPEED >= 85 && a.POWER >= 72 && traits.length < 3) traits.push("FAST_STARTER");
  if (a.IQ >= 87 && a.POWER < 78 && traits.length < 3) traits.push("COUNTER_STRIKER");
  if (a.CARDIO >= 78 && a.SPEED < 75 && traits.length < 3) traits.push("PRESSURE_FIGHTER");
  return traits.slice(0, 4);
}

// Small, capped deltas applied on top of the normal engine -- never large
// enough to overturn a stat mismatch on their own. PACE_SETTER and
// IRON_CHIN are derived traits but don't add a modifier here -- there's no
// decision-weighting step anywhere in simulateRounds for one to feed
// (decisions are just whatever's left when no finish happens), so the two
// stay identity/narrative-only rather than pretending to grant a bonus
// that doesn't exist. The CHIN/CARDIO/IQ stats behind them already have
// their own real, continuous effects elsewhere in this engine.
function traitModifiers(traits) {
  const m = { winProbDelta: 0, koBoost: 0, subBoost: 0 };
  (traits || []).forEach((t) => {
    if (t === "KO_THREAT") m.koBoost += 6;
    if (t === "SUB_THREAT") m.subBoost += 6;
    if (t === "COUNTER_STRIKER") m.winProbDelta += 0.02;
    if (t === "PRESSURE_FIGHTER") m.winProbDelta += 0.015;
  });
  return m;
}

// ---- Matchup analysis: compares each fighter's single best attribute and
// labels the gap. This is a simple, honest read of the actual numbers --
// not a full simulation of every stat interaction. ----
function topAttr(a) {
  let best = { key: "STRIKING", value: -1 };
  SKILL_KEYS.forEach((k) => { if (a[k] > best.value) best = { key: k, value: a[k] }; });
  return best;
}

function buildMatchup(player, opp) {
  const yourStrength = topAttr(player);
  const oppStrength = topAttr(opp);
  const gap = yourStrength.value - oppStrength.value;
  let label = "Even Matchup";
  if (gap >= 15) label = "Favorable Matchup";
  else if (gap >= 6) label = "Slight Advantage";
  else if (gap <= -15) label = "Nightmare Matchup";
  else if (gap <= -6) label = "Dangerous Matchup";
  return { yourStrength, oppStrength, label };
}

// ---- Fight narrative: short flavor text generated from the actual phase
// control, result, method, and traits of the fight that already happened.
// It never claims a specific strike or exchange the engine didn't produce --
// it describes the general shape of the fight the numbers already decided. ----
function buildFightNarrative(phase, result, playerTraits) {
  const lines = [];
  if (phase.groundShare > 0.62) {
    lines.push(playerTraits.includes("WRESTLER") || playerTraits.includes("SUB_THREAT")
      ? "He forces the fight to the mat early and stays in control."
      : "The fight spends most of its time on the ground.");
  } else if (phase.standShare > 0.62) {
    lines.push("Both fighters keep it standing and trade at range.");
  } else {
    lines.push("The fight moves between striking range, the clinch, and the mat.");
  }

  if (result.win) {
    if (result.method === "KO/TKO") lines.push("A clean shot lands and the legs go out. KNOCKDOWN -- the referee steps in.");
    else if (result.method === "Submission") lines.push("A scramble ends with a fight-ending submission locked in tight. The tap comes just in time.");
    else lines.push("The final horn sounds after a competitive distance fight, and the scorecards favor the cleaner volume.");
  } else {
    if (result.method === "KO/TKO Loss") lines.push("A counter shot lands clean and the fight is waved off.");
    else if (result.method === "Submission Loss") lines.push("Caught in deep water with no way out of the hold.");
    else lines.push("A close one goes the distance, and the cards don't fall his way.");
  }
  return lines;
}

// A cage-side mic-in-face soundbite for the fight card, picked by what kind
// of result this actually was -- title stakes and rivalries outrank a plain
// finish, which outranks a plain decision. Two variants per bucket keep a
// long career from repeating the same line every time it lands in the same
// bucket; which flavor of underdog/close moment you hit is what changes,
// the fight numbers themselves are untouched by any of this.
function buildInterviewLine(oppName, { win, winProb }, flags) {
  const { isTitleShot, isTitleDefense, isRivalry, isStatement, bonusType, fightWasClose } = flags;
  const pick = (a, b) => (Math.random() < 0.5 ? a : b);
  if (isTitleShot && win) {
    return pick(
      `"I told you I'd get here. This belt is mine now."`,
      `"Years of work for this one moment -- and I took it."`,
    );
  }
  if (isTitleDefense && win) {
    return pick(
      `"Come get it. I'll be right here."`,
      `"Still the champ. That's not changing anytime soon."`,
    );
  }
  if (isTitleDefense && !win) {
    return pick(
      `"He was better tonight. I'll be back for it."`,
      `"That's the game. I'll earn my way back to this spot."`,
    );
  }
  if (isRivalry && win) {
    return pick(
      `"That's for everything he's said. We're done now."`,
      `"I've been waiting a long time to settle that."`,
    );
  }
  if (win && winProb < 0.42) {
    return pick(
      `"Nobody gave me a chance in there. Nobody."`,
      `"They called it an upset. I call it a plan that worked."`,
    );
  }
  if (isStatement && win) {
    return pick(
      `"${oppName} is a real name. Now so am I."`,
      `"Beat the best guy they put in front of me. Who's next?"`,
    );
  }
  if (win && bonusType === "performance") {
    return pick(
      `"When it's there, I take it. Simple as that."`,
      `"Felt it land clean. I knew it was over."`,
    );
  }
  if (win && bonusType === "fotn") {
    return pick(
      `"That's what this sport's supposed to look like."`,
      `"We left it all in there tonight. Both of us."`,
    );
  }
  if (win && fightWasClose) {
    return pick(
      `"Not pretty, but a win's a win."`,
      `"He made me work for every second of that."`,
    );
  }
  if (win) {
    return pick(
      `"Did the job. On to the next one."`,
      `"Nothing fancy -- just went in there and won."`,
    );
  }
  if (!win && bonusType === "fotn") {
    return pick(
      `"I'll take that loss. That was a real fight."`,
      `"Came up short, but I've got no regrets about how I fought."`,
    );
  }
  if (!win && winProb > 0.6) {
    return pick(
      `"Got caught. It happens to everybody in this sport."`,
      `"One mistake and it was over. I know better now."`,
    );
  }
  if (!win && fightWasClose) {
    return pick(
      `"I thought I did enough. The judges saw it differently."`,
      `"Close one. Could've gone either way."`,
    );
  }
  return pick(
    `"Credit to him. Back to the drawing board."`,
    `"That's a loss I need to learn from."`,
  );
}

// American-odds formatting from a raw win probability -- the standard
// sportsbook convention (favorites negative, underdogs positive), so the
// pre-fight screen reads like a real odds board instead of a bare percent.
// Deliberately not exported: it's display formatting for pendingFight's
// already-computed winProb, not a piece of the simulation itself.
function formatOdds(prob) {
  const p = clamp(prob, 0.01, 0.99);
  if (p >= 0.5) return `-${Math.round((100 * p) / (1 - p))}`;
  return `+${Math.round((100 * (1 - p)) / p)}`;
}

// Fight-week flavor -- the countdown/weigh-in beat before a booked fight
// actually happens. Mostly texture, but it does surface the weight-cut
// penalty when one is active, since that's a real, felt effect the player
// chose to live with (a weight-class move) rather than just flavor.
function buildFightWeekLine(state, isTitleFight, isRivalry, isContenderSeriesFight, isCallout) {
  const pick = (a, b) => (Math.random() < 0.5 ? a : b);
  if (isContenderSeriesFight) {
    return pick(
      "Fight week. One performance, one contract on the line -- this is the shot.",
      "Fight week. Everyone in the building is trying to get signed tonight. Only one performance gets remembered.",
    );
  }
  if (isCallout) {
    return pick(
      "Fight week. You called this one out yourself -- no backing down now.",
      "Fight week. You picked this fight in front of everyone. Time to prove it wasn't just talk.",
    );
  }
  if (state.weightPenaltyFightsLeft > 0) {
    return "Fight week. The scale wasn't kind during the cut -- this one comes with a cost.";
  }
  if (isTitleFight) {
    return pick(
      "Fight week. Championship weigh-ins, cameras everywhere, one shot at the belt.",
      "Fight week. Everything comes down to this walk to the cage.",
    );
  }
  if (isRivalry) {
    return pick(
      "Fight week. Both corners made weight without incident -- the bad blood is the real story.",
      "Fight week. No love lost at staredowns -- this one's personal.",
    );
  }
  return pick(
    "Fight week. Both fighters made weight -- nothing left to do now but fight.",
    "Fight week. Weigh-ins are done, the stare-down's over, fight night is here.",
  );
}

// Pre-fight trash talk -- the opponent's voice, not the player's (that's
// buildInterviewLine, spoken after). Same cascading-by-stakes shape, using
// only signals already known before the fight (title stakes, rivalry, the
// odds themselves), never anything the coin flip decides.
function buildTrashTalk(oppName, winProb, isTitleFight, isRivalry, isContenderSeriesFight, isCallout) {
  const pick = (a, b) => (Math.random() < 0.5 ? a : b);
  if (isContenderSeriesFight) {
    return pick(
      `"${oppName}: 'I've been grinding for this my whole career. I'm not losing it here.'"`,
      `"${oppName}: 'Somebody's getting signed tonight. It's going to be me.'"`,
    );
  }
  if (isCallout) {
    return pick(
      `"${oppName}: 'You wanted this fight. Now you've got it -- and you're going to regret it.'"`,
      `"${oppName}: 'Calling me out was the last good decision you're going to make.'"`,
    );
  }
  if (isRivalry) {
    return pick(
      `"${oppName}: 'We've done this before. I know exactly how it ends.'"`,
      `"${oppName}: 'This is personal. He knows why.'"`,
    );
  }
  if (isTitleFight) {
    return pick(
      `"${oppName}: 'The belt's coming home with me. Simple as that.'"`,
      `"${oppName}: 'Everything I've worked for comes down to this.'"`,
    );
  }
  if (winProb <= 0.4) {
    // The opponent is favored here (this is the player's win probability).
    return pick(
      `"${oppName}: 'No disrespect, but I don't see how he wins this.'"`,
      `"${oppName}: 'I've fought better than him. This should be easy.'"`,
    );
  }
  if (winProb >= 0.6) {
    return pick(
      `"${oppName}: 'Everyone's overlooking me. Watch what happens.'"`,
      `"${oppName}: 'I've got nothing to lose in there. That's dangerous.'"`,
    );
  }
  return pick(
    `"${oppName}: 'May the best man win. That's me, by the way.'"`,
    `"${oppName}: 'I respect him. Doesn't mean I'm losing to him.'"`,
  );
}

// The RNG-free half of a fight's resolution -- phase control, the matchup
// read, and win probability are all pure functions of the two fighters'
// stats, with no coin flip yet. Split out so a pre-fight screen can show
// real odds ahead of the result, computed the exact same way the engine
// itself will use them a moment later -- not a second, possibly-drifted
// estimate.
function computeFightPreview(player, reachScore, opp, stanceBias, playerTraits, oppTraits) {
  const phase = estimatePhaseControl(player, opp, stanceBias);
  const pMod = traitModifiers(playerTraits);
  const oMod = traitModifiers(oppTraits);
  const winProb = clamp(computeWinProbability(player, opp, phase, reachScore) + pMod.winProbDelta - oMod.winProbDelta, 0.05, 0.95);
  const matchup = buildMatchup(player, opp);
  return { phase, matchup, winProb, pMod, oMod };
}

// totalRounds now drives an actual round-by-round simulation (see
// simulateRounds) rather than a single coin flip -- winProb from the
// pre-fight preview is still returned unchanged, since Wave 2's odds
// display and everything keyed off it (rivalry "close fight" detection,
// the underdog-win Legacy bonus) reads that pre-fight estimate, not a
// post-hoc read of the actual rounds.
function resolveFight(player, reachScore, opp, stanceBias, playerTraits, oppTraits, totalRounds) {
  const { phase, matchup, winProb, pMod, oMod } = computeFightPreview(player, reachScore, opp, stanceBias, playerTraits, oppTraits);
  const { win, method, rounds, stats } = simulateRounds(player, opp, phase, pMod, oMod, totalRounds);
  // Narrative is strictly downstream of the sim -- generated once, here,
  // from the already-decided rounds/stats, and never read by anything that
  // could feed back into a probability, roll, or outcome. See narrative.js.
  const roundNarratives = buildFightStory(rounds, method);
  const moments = identifyFightMoments(rounds, !!stats.player.knockdowns, !!stats.opp.knockdowns, stats.finishRound, method, win);
  const howItHappenedText = summarizeHowItHappened(rounds, win, method, stats.finishRound);
  return {
    win, method, phase, winProb, matchup, rounds, stats,
    narrative: buildFightNarrative(phase, { win, method }, playerTraits || []),
    roundNarratives, moments, howItHappened: howItHappenedText,
  };
}

function updateRanking(rankPoints, win, oppOverall, isTitleFight) {
  if (win) {
    const delta = 8 + Math.max(0, oppOverall - 70) * 0.4 + (isTitleFight ? 6 : 0);
    return clamp(rankPoints + delta, 0, 100);
  }
  const softenedBy = Math.max(0, oppOverall - 70) * 0.15;
  // A lost title shot already costs the streak (resets to 0 on any loss)
  // and the belt never got any closer -- piling an extra rankPoints
  // penalty on top used to mean a near-miss and a blowout cost the same
  // amount to rebuild from, which made repeated cracks at a tough champion
  // punishingly slow to requalify for. Trimmed so a title-fight loss still
  // stings, just not doubly.
  const delta = 8 + Math.max(0, 70 - oppOverall) * 0.3 + (isTitleFight ? 2 : 0) - softenedBy;
  return clamp(rankPoints - delta, 0, 100);
}

// Reads off playerRank -- the actual division ladder position -- not
// rankPoints. rankPoints is a hidden/continuous competitive-momentum value
// used internally (matchmaking calibration, Legacy Score); it used to also
// drive this label, which let it climb from farmed wins over opponents who
// never moved the real ladder at all -- the HUD could say "Top 15" while
// the Rankings tab still showed Unranked. playerRank can't be farmed like
// that: it only moves by actually beating a ranked opponent (see the climb
// logic in commitFight), so the label and the ladder now always agree.
function rankLabel(playerRank, champion) {
  if (champion) return "Champion";
  if (playerRank == null) return "Unranked";
  if (playerRank === 1) return "#1 Contender";
  if (playerRank <= 5) return "Top 5";
  if (playerRank <= 10) return "Top 10";
  return "Top 15";
}

// ---- Career-stage progression (the promotional "ladder") ------------------
// Purely derived from rankPoints, so it can also drop back down after a bad
// losing stretch -- getting sent back to the Regional Circuit after losing
// your foothold is meant to sting.
// ---- The CLF ladder -------------------------------------------------------
// CLF = CageLab Fights, the in-game promotion. Tiers are derived purely from
// rankPoints, so a bad losing stretch can send you back down -- getting cut
// from the main roster is meant to sting as much as promotion feels good.
// Contender Series sits directly below PREMIER, not down with Regional/
// National -- like its real-world namesake, it's the last-look tryout card
// that feeds straight into the main roster, not an early developmental rung.
const CLF_TIERS = [
  { name: "CLF Regional", short: "REGIONAL", blurb: "Small halls, real fights, no cameras yet." },
  { name: "CLF National", short: "NATIONAL", blurb: "Televised cards. The division knows your name now." },
  { name: "CLF Contender Series", short: "CONTENDER SERIES", blurb: "Proving grounds. Win here and someone finally notices." },
  { name: "CLF PREMIER", short: "PREMIER", blurb: "The main roster. Champions are made here." },
];

const CLF_TIER_ORDER = CLF_TIERS.map((t) => t.name);

const clfTier = (name) => CLF_TIERS.find((t) => t.name === name) || CLF_TIERS[0];

// A plausible W-L record for a generated opponent, scaled by how far into the
// career this fight happens and how good the opponent's overall rating is.
// Not a persistent identity across rematches (the engine regenerates
// opponents fresh each fight) -- treat it as "their record coming in," same
// as a broadcast would show for someone you've never fought before.
//
// tier sets the win-rate floor: being ranked in the division (let alone
// holding the belt) is itself evidence of a winning record -- the old flat
// formula bottomed out below 50% for anyone with a merely average overall,
// which meant the bottom of a freshly-built Top 15 could show a losing
// record on day one. Unranked prospects are the only ones who can plausibly
// be below .500 -- they're still trying to break in.
// These same floors also bound how far the background sim (below) can let a
// ranked-pool record drift once the career is underway.
const CHAMPION_WIN_FLOOR = 0.68;
const RANKED_WIN_FLOOR = 0.55;

// Shared by generateOpponentRecord (the career-long W-L) and
// generateRecentForm (a fresh roster fighter's starting last-5) so both
// read off the same underlying quality, not two independently-rolled ideas
// of how good this fighter actually is.
function winRateFor(overall, tier) {
  if (tier === "champion") return clamp(0.72 + (overall - 85) / 200, CHAMPION_WIN_FLOOR, 0.92);
  if (tier === "ranked") return clamp(0.58 + (overall - 70) / 150, RANKED_WIN_FLOOR, 0.85);
  return clamp(0.4 + (overall - 60) / 120, 0.3, 0.75);
}

function generateOpponentRecord(overall, fightIndexContext, tier) {
  const experience = clamp(Math.round(fightIndexContext * 0.6 + (overall - 50) * 0.3), 3, 40);
  const winRate = winRateFor(overall, tier);
  const wins = Math.round(experience * winRate);
  const losses = Math.max(0, experience - wins);
  return { w: wins, l: losses };
}

// A fresh roster fighter's last-5 form, newest first -- shown in the
// matchmaking picker (see generateMatchmakerOptions) so "who should I
// fight" has a hot/cold-streak signal, not just a career-long W-L. Drawn
// straight from the fighter's own record (not a fresh independent roll off
// winRate) so the last-5 can never show more losses than the fighter has
// ever actually recorded -- a shuffled sample of their real career, not a
// second, uncorrelated coin flip that could contradict it.
function generateRecentForm(wins, losses, count = 5) {
  const pool = [];
  for (let i = 0; i < wins; i++) pool.push("W");
  for (let i = 0; i < losses; i++) pool.push("L");
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

// Appends one result to a fighter's rolling last-5, newest first, capped
// at 5 -- the single place every win/loss touching a division fighter's
// record also updates their form, so the two can never drift apart.
function pushForm(fighter, win) {
  fighter.recentForm = [win ? "W" : "L", ...(fighter.recentForm || [])].slice(0, 5);
}

// ---- Fighting-style choice: gives the archetype system real teeth ---------
// Reuses the same ARCHETYPES multiplier tables that already drive opponent
// generation, so "your style" and "their style" are the same underlying
// concept instead of two disconnected systems.
// Scores how well a fighter's stat SHAPE matches an archetype's emphasis.
//
// The earlier version summed base[k] * mult[k], which was broken: archetypes
// don't all have the same total multiplier weight (Granite Grinder totalled
// 8.10 vs Striker's 7.85), so the heaviest archetype won by default and every
// fighter came out a "Granite Grinder" regardless of their actual stats.
//
// This instead measures ALIGNMENT: for each attribute, how far above/below the
// fighter's own average is it, multiplied by how much this archetype cares
// about that attribute. A fighter whose peaks land exactly where the archetype
// emphasizes scores high; total magnitude cancels out.
function scoreArchetypeFitFlat(base, archetype) {
  const mean = SKILL_KEYS.reduce((s, k) => s + base[k], 0) / SKILL_KEYS.length;
  // The archetype's signature attribute -- the one it emphasizes most.
  let signature = null, topMult = 1;
  Object.entries(archetype.mult).forEach(([k, v]) => { if (v > topMult) { topMult = v; signature = k; } });

  return SKILL_KEYS.reduce((s, k) => {
    const emphasis = (archetype.mult[k] || 1) - 1; // +ve = wants it, -ve = doesn't
    // Signature attribute counts triple, so a defining peak (95 Wrestling)
    // outweighs incidental overlap on an archetype's secondary traits.
    const weight = k === signature ? 3 : 1;
    let contrib = (base[k] - mean) * emphasis * weight;
    // What a fighter EXCELS at defines their style more than what they lack,
    // so negative-emphasis terms count half. Without this, a wrestler with low
    // Power scored as a "Granite Grinder" purely for the shared weakness.
    if (emphasis < 0) contrib *= 0.5;
    return s + contrib;
  }, 0);
}

// Returns the archetype whose shape the build actually matches, or "Balanced"
// when nothing stands out -- an even build genuinely has no specialty, and
// forcing it into a random archetype would be a lie.
const ARCHETYPE_FIT_THRESHOLD = 2.5;

function bestFitArchetypeFlat(base) {
  const candidates = ARCHETYPES.filter((a) => a.name !== "Balanced");
  let best = null, bestScore = -Infinity;
  candidates.forEach((a) => {
    const score = scoreArchetypeFitFlat(base, a);
    if (score > bestScore) { bestScore = score; best = a; }
  });
  return bestScore < ARCHETYPE_FIT_THRESHOLD ? "Balanced" : best.name;
}

// riskMultiplier lets Camp Length (full camp vs short notice) push injury odds
// down or up for the year.
function rollInjury(effective, riskMultiplier) {
  const durability = (effective.CHIN + effective.CARDIO + effective.SPEED) / 3;
  const risk = Math.max(0.02, (0.16 - durability / 1100) * (riskMultiplier || 1));
  if (Math.random() > risk) return null;
  return { major: Math.random() < 0.3 };
}

function rollHypeEvent(iq, isTitle, isRival) {
  const pool = ["STRIKING", "GRAPPLING", "WRESTLING", "CARDIO", "POWER", "CHIN", "SPEED"];
  const attr = pool[Math.floor(Math.random() * pool.length)];
  const positive = Math.random() < 0.6;
  let delta = positive ? 5 : -5;
  if (!positive && iq >= 80) delta = Math.round(delta / 2);
  const context = isTitle ? "Title fight week" : isRival ? "Grudge match week" : "Fight week";
  const label = ATTR_BY_KEY[attr].label.toLowerCase();
  const text = positive
    ? `${context} — the extra spotlight sharpened ${label}.`
    : `${context} — the pressure got to ${label}.`;
  return { attr, delta, positive, text };
}

// Retuned alongside the GOAT Score changes: legacy bonuses trimmed slightly
// and verdict thresholds raised so Hall of Fame-tier careers feel earned.
function calculateLegacy(state) {
  const {
    record, finishes, titleReigns, titleDefenses, peakRankPoints,
    rankedFightCount, statementWins, rivalryWins, oppQualitySumWins, runningLegacy,
  } = state;
  const totalWins = record.w;
  const finishRate = totalWins ? (finishes.ko + finishes.sub) / totalWins : 0;
  const strengthOfSchedule = totalWins ? oppQualitySumWins / totalWins : 0;

  let bonus = 0;
  bonus += Math.round(finishRate * 40);
  bonus += Math.round(Math.max(0, strengthOfSchedule - 70) * 1.5);
  bonus += Math.round(peakRankPoints * 0.5);
  bonus += Math.round(rankedFightCount * 0.8);
  bonus += statementWins * 5;
  bonus += rivalryWins * 4;
  bonus += titleReigns * 20 + titleDefenses * 10;

  return { legacyScore: Math.max(0, runningLegacy + bonus), bonus, finishRate, strengthOfSchedule };
}

// Verdict tiers above "Legitimate Contender" are meant to read as real
// top-level accomplishment, not just a big number racked up beating a
// weaker bracket -- a Hall of Fame case needs a real record AT the top
// level, not just a great one somewhere below it. Capped by the highest
// circuit tier the career actually reached (peakCircuitTier), regardless
// of how big the raw score got getting there.
const VERDICT_ORDER = [
  "Prospect Who Never Broke Through", "Journeyman", "Legitimate Contender",
  "Fringe Hall of Famer", "Hall of Fame", "First-Ballot Hall of Famer", "Generational Talent",
];
const VERDICT_TIER_CAP = {
  "CLF Regional": "Legitimate Contender",
  "CLF National": "Fringe Hall of Famer",
  "CLF Contender Series": "Hall of Fame",
  "CLF PREMIER": "Generational Talent",
};

function verdictFor(score, peakCircuitTier) {
  let verdict;
  if (score >= 300) verdict = "Generational Talent";
  else if (score >= 225) verdict = "First-Ballot Hall of Famer";
  else if (score >= 160) verdict = "Hall of Fame";
  else if (score >= 105) verdict = "Fringe Hall of Famer";
  else if (score >= 60) verdict = "Legitimate Contender";
  else if (score >= 22) verdict = "Journeyman";
  else verdict = "Prospect Who Never Broke Through";

  const cap = VERDICT_TIER_CAP[peakCircuitTier] || VERDICT_TIER_CAP["CLF Regional"];
  return VERDICT_ORDER.indexOf(verdict) > VERDICT_ORDER.indexOf(cap) ? cap : verdict;
}

// ---- Interactive career state machine -----------------------------------
// Unlike a batch simulation, the career unfolds one step at a time so the
// player can make Camp Planning and Fight Selection choices along the way.
// `timeline` only ever contains events that have actually happened, so the
// UI can render it directly with no separate "revealed" index.
// =========================================================================
//  THE DIVISION (persistent world)
//  Previously every opponent was generated fresh and thrown away, so there
//  was no world between your fights -- no standings, no champion who existed
//  when you weren't fighting, and a rival showed a different record each time
//  you met. This builds a real division: 15 ranked contenders plus a champion,
//  each with a persistent identity and record, who fight each other in the
//  background while your career runs.
// =========================================================================
const DIVISION_SIZE = 15;      // how many are RANKED (plus the champion at index 0)

const UNRANKED_COUNT = 24;     // prospects below the rankings you fight on the way up

function createDivisionFighter(name, baseRating, seedIndex, tier) {
  const profile = generateOpponentProfile(baseRating);
  const record = generateOpponentRecord(profile.overall, 8 + Math.floor(Math.random() * 12), tier);
  return {
    id: `div-${seedIndex}-${slugify(name)}`,
    name,
    attrs: profile.attrs,
    overall: profile.overall,
    archetype: profile.archetype,
    traits: profile.traits,
    record,
    recentForm: generateRecentForm(record.w, record.l),
    isChampion: false,
  };
}

// Builds the division ladder: index 0 is the champion, 1..15 are ranked
// contenders in descending strength.
function buildDivision() {
  const total = DIVISION_SIZE + 1 + UNRANKED_COUNT;
  const names = generateOpponentNames(total);
  const roster = names.map((name, i) => {
    // Champion is strongest; strength tapers through the rankings and keeps
    // falling through the unranked tier below them.
    const tier = i === 0 ? "champion" : i <= DIVISION_SIZE ? "ranked" : "unranked";
    const baseRating = i === 0
      ? 92
      : i <= DIVISION_SIZE
        ? clamp(Math.round(90 - i * 2.1 + (Math.random() * 6 - 3)), 58, 91)
        : clamp(Math.round(60 - (i - DIVISION_SIZE) * 0.5 + (Math.random() * 8 - 4)), 45, 62);
    return createDivisionFighter(name, baseRating, i, tier);
  });
  roster[0].isChampion = true;
  return roster;
}

// ---- Contender Series ------------------------------------------------------
// Not a ladder like the other three tiers -- no rankings, no belt of its
// own. Just one (occasionally two, if the first showcase doesn't go your
// way) short-notice fight against someone else also trying to break in,
// real UFC Contender Series-style: win it and the Premier contract is
// waiting; lose it and it's back to National to build the case again.
function generateContenderSeriesOpponent() {
  const profile = generateOpponentProfile(clamp(Math.round(78 + Math.random() * 10), 40, 99));
  const name = generateOpponentNames(1)[0];
  return {
    id: `cs-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    name,
    attrs: profile.attrs,
    overall: profile.overall,
    archetype: profile.archetype,
    traits: profile.traits,
    record: generateOpponentRecord(profile.overall, 14, "ranked"),
    isChampion: false,
  };
}

// Records a round loss for a division fighter, but never lets it push a
// ranked-pool member (or the champion) below the win-rate floor their tier
// was seeded with. Every fighter simulateDivisionRound touches is already
// in the champion/ranked pool -- the unranked tier below never fights here
// -- so a plain loss would otherwise let a career's worth of coin-flip
// background rounds erode a legitimately-ranked record into something that
// reads as mediocre (a "12-10" for a Top 15 fighter). Below the floor, nights
// like that just don't stick to the official record.
function applyRoundLoss(fighter) {
  const floor = fighter.isChampion ? CHAMPION_WIN_FLOOR : RANKED_WIN_FLOOR;
  const total = fighter.record.w + fighter.record.l + 1;
  if (fighter.record.w / total < floor) return;
  fighter.record.l += 1;
  pushForm(fighter, false);
}

// Simulates the fights you weren't part of. Adjacent ranks meet, the winner
// can swap places with the loser, and the champion defends against the top
// contender -- so the standings genuinely move while your career runs.
function simulateDivisionRound(division) {
  const d = division.map((f) => ({ ...f, record: { ...f.record } }));

  // A title fight happens roughly every other round -- but only when the
  // belt actually lives inside this division. When the player holds it,
  // nobody in the roster is flagged isChampion, and the background sim must
  // not invent a new NPC champion behind the player's back; the ranked pool
  // just keeps fighting for position underneath them instead.
  const champIdx = d.findIndex((f) => f.isChampion);
  if (champIdx !== -1 && Math.random() < 0.5 && d.length > 1) {
    const challengerIdx = champIdx === 0 ? 1 : 0;
    const champ = d[champIdx], challenger = d[challengerIdx];
    const champWins = Math.random() < 0.5 + (champ.overall - challenger.overall) / 60;
    if (champWins) {
      champ.record.w += 1;
      pushForm(champ, true);
      applyRoundLoss(challenger);
    } else {
      challenger.record.w += 1;
      pushForm(challenger, true);
      applyRoundLoss(champ);
      champ.isChampion = false;
      challenger.isChampion = true;
      d[champIdx] = challenger;
      d[challengerIdx] = champ;
    }
  }

  // Two contender bouts between neighbouring RANKED fighters. The unranked
  // tier below doesn't affect the standings. Normally index 0 is reserved
  // for the champion and sits out of this pool; while the belt is vacant
  // from this division's point of view (the player holds it), index 0 is
  // just the #1 contender and needs to keep fighting like everyone else.
  const rankedStart = champIdx === -1 ? 0 : 1;
  const rankedEnd = Math.min(DIVISION_SIZE, d.length - 1);
  for (let n = 0; n < 2; n++) {
    const i = rankedStart + Math.floor(Math.random() * Math.max(1, rankedEnd - rankedStart));
    const j = i + 1;
    if (j > rankedEnd) continue;
    const aWins = Math.random() < 0.5 + (d[i].overall - d[j].overall) / 60;
    if (aWins) {
      d[i].record.w += 1;
      pushForm(d[i], true);
      applyRoundLoss(d[j]);
    } else {
      d[j].record.w += 1;
      pushForm(d[j], true);
      applyRoundLoss(d[i]);
      const tmp = d[i]; d[i] = d[j]; d[j] = tmp; // upset moves them up the ladder
    }
  }
  return d;
}

// Moves the fighter at `fromIdx` out of the front of the ranked ladder and
// reinserts them `dropBy` spots lower (clamped to stay inside the ranked
// pool) -- used right after a title fight so the SAME contender doesn't
// keep getting rebooked as the next challenger fight after fight. Without
// this, index 0 (the "next in line" slot once the player holds the belt)
// only ever moves when the background sim happens to pick it for one of
// its two random ranked-neighbour bouts and the incumbent happens to lose
// -- rare enough that a beaten challenger could realistically get 4+
// straight rematches by pure chance, same as the record you fought.
function demoteInDivision(division, fromIdx, dropBy) {
  if (fromIdx < 0 || fromIdx >= division.length) return division;
  const d = division.slice();
  const [moved] = d.splice(fromIdx, 1);
  const insertAt = clamp(fromIdx + dropBy, fromIdx + 1, Math.min(DIVISION_SIZE, d.length));
  d.splice(insertAt, 0, moved);
  return d;
}

// Picks who you fight next out of the real division, based on where you stand.
// Higher rank = you face people nearer the top.
// avoidIds (optional): opponent ids faced in the last few fights -- reroll a
// handful of times to dodge landing on the same person back-to-back by pure
// chance. Bounded, so a thin division can't spin forever, and never applies
// to the title-fight path (that's resolved by flag, not by this draw).
// National is meant to be a materially stronger feeder stage than Regional
// -- lower array index is a stronger fighter -- so this caps how weak
// National's centre-of-the-draw can go, regardless of how little
// rankPoints the player has actually built up at this tier yet (which is
// always freshly reset to 0 on entering National, same as Regional).
// Deliberately does NOT touch playerRankPoints itself: real momentum built
// during the National run still pulls the draw tougher once it's earned
// (Math.min below only ever makes centre stronger, never weaker, than
// this), so the underlying rankPoints stays truthful -- this only sets a
// tier-driven floor on the matchmaking curve, not a fake ranking.
const NATIONAL_MATCHMAKING_CEILING = 10;

function selectDivisionOpponent(division, playerRankPoints, forTitle, avoidIds, difficulty, circuitTier) {
  if (forTitle) {
    // Always resolve the title fight off the isChampion flag, never off
    // array position -- once the player has held the belt, the old champ no
    // longer sits at a reserved "index 0 = champion" slot, they're just the
    // top of the ranked pool. If nobody in the division is flagged (the
    // player already holds the title, or it's vacant), the opponent is the
    // #1 ranked contender instead, which is exactly who a champion should
    // be defending against.
    const champIdx = division.findIndex((f) => f.isChampion);
    const idx = champIdx === -1 ? 0 : champIdx;
    return { fighter: division[idx], rank: idx };
  }
  // Map rank points onto a slot in the ladder. Low-ranked fighters draw from
  // the unranked tier; as you climb, opponents come from higher up the ranks.
  const span = division.length - 1;
  let centre = Math.round(span - (playerRankPoints / 100) * (span - 1));
  if (circuitTier === "CLF National") centre = Math.min(centre, NATIONAL_MATCHMAKING_CEILING);
  // The matchmaking-menu's "Easy Fight" / "Step-Up Fight" choices bias who
  // actually gets drawn -- lower array index is a stronger fighter (index 0
  // is the champion), so easy pushes the centre toward a higher index
  // (weaker) and step-up pulls it toward a lower one (tougher). Legacy gain
  // and win probability both already scale off the opponent's real overall
  // rating, so shifting who gets drawn is the whole fix: it's what makes
  // those buttons' "lower risk & reward" / "very tough, major reward"
  // promises real instead of purely cosmetic labels on an identical draw.
  if (difficulty === "easy") centre = clamp(centre + 8, 1, span);
  else if (difficulty === "stepUp") centre = clamp(centre - 8, 1, span);
  const avoid = avoidIds || [];
  let target = clamp(centre + Math.floor(Math.random() * 7 - 3), 1, span);
  if (avoid.includes(division[target].id)) {
    // Re-sampling the same +-3 jitter and re-clamping doesn't reliably
    // dodge the avoid list -- near either end of the rank range, most of
    // the jitter offsets clamp down to the same one or two edge indices,
    // so a plain reroll keeps landing back on exactly the fighter being
    // avoided. Instead, pick uniformly from whichever fighters in the
    // window are actually free; only accept the repeat if none are.
    const windowLo = clamp(centre - 3, 1, span);
    const windowHi = clamp(centre + 3, 1, span);
    const free = [];
    for (let i = windowLo; i <= windowHi; i++) { if (!avoid.includes(division[i].id)) free.push(i); }
    if (free.length) target = free[Math.floor(Math.random() * free.length)];
  }
  return { fighter: division[target], rank: displayRankFor(division, target) };
}

// The displayed Top 15 numbering excludes whoever is flagged champion.
// Normally that's index 0, so array index and display rank line up (index
// itself never dips into index 0 for a non-champion fighter). But during a
// vacant title -- nobody in the division flagged, belt held by the player
// or open after an interim -- there's no entry to exclude, so every
// displayed rank sits one higher than its raw array index. Anything past
// DIVISION_SIZE is unranked -- report null so the UI shows "unranked"
// rather than a fake #27 (or, for a caller that skipped this and used the
// raw array index directly, an outright wrong one -- see callout/matchmaker
// picks below, which used to do exactly that).
function displayRankFor(division, index) {
  const hasDivisionChampion = division.some((f) => f.isChampion);
  const displayRank = hasDivisionChampion ? index : index + 1;
  return displayRank <= DIVISION_SIZE ? displayRank : null;
}

// Three REAL, named candidates for the matchmaking panel -- replaces
// picking a hidden difficulty label with actually seeing who you'd be
// fighting: their name, archetype, and real last-5 form, before
// committing to anything. Reuses selectDivisionOpponent's own easy/ranked/
// stepUp bias, so the risk/reward promise behind each tag is exactly what
// it already was -- just visible now instead of hidden behind the label.
// The draws are chained through a growing avoid-list so the three options
// are never the same person twice.
function generateMatchmakerOptions(division, playerRankPoints, recentOpponentIds, circuitTier) {
  const tags = ["easy", "ranked", "stepUp"];
  const avoid = [...(recentOpponentIds || [])];
  const pickedRecords = [];
  return tags.map((tag) => {
    // Distinct people is already guaranteed by the avoid-list, but their
    // W-L record is a separate independent roll (see generateOpponentRecord)
    // that doesn't scale with tier the way overall does -- two of the three
    // panels landing on the exact same record isn't rare, and when it
    // happens the "risk" framing has nothing backing it up: the Step-Up
    // pick reads no tougher than Easy on paper, so there's no real reason
    // not to always take the bigger reward. A few bounded re-draws against
    // an already-picked record (same avoid-list mechanism as distinctness)
    // usually finds someone whose record actually looks different; if the
    // division's too thin to avoid it, showing the repeat beats looping.
    let picked;
    for (let attempt = 0; attempt < 5; attempt++) {
      picked = selectDivisionOpponent(division, playerRankPoints, false, avoid, tag, circuitTier);
      const dupRecord = pickedRecords.some((r) => r.w === picked.fighter.record.w && r.l === picked.fighter.record.l);
      if (!dupRecord) break;
      avoid.push(picked.fighter.id);
    }
    avoid.push(picked.fighter.id);
    pickedRecords.push(picked.fighter.record);
    return {
      tag, fighterId: picked.fighter.id, rank: picked.rank,
      name: picked.fighter.name, archetype: picked.fighter.archetype,
      overall: picked.fighter.overall, record: picked.fighter.record,
      recentForm: picked.fighter.recentForm || [],
    };
  });
}

// ---- Rivals ---------------------------------------------------------------
// A rivalry is earned, not assigned: 2+ meetings against the same division
// fighter, with at least one of them genuinely competitive -- a decision, or
// a finish the engine itself rated close to a coin flip. Two lopsided
// blowouts never create one. Multiple rivals can be active at once (a list,
// not a single rivalName), and each is re-validated every fight against the
// player's CURRENT overall -- the same "persisted + re-validated, not
// inferred from something incidental" fix as the champion-flag bug. Without
// that re-validation, a rival met back in the Regional days keeps getting
// rebooked forever regardless of how far the player has outgrown them.
const RIVAL_MIN_MEETINGS = 2;
const RIVAL_CLOSE_WINPROB_BAND = 0.12; // winProb within .38-.62 counts as competitive
const RIVAL_OVR_DORMANCY_GAP = 18;     // outgrow a rival by more than this and they go dormant

function isCloseFight(method, winProb) {
  return method.startsWith("Decision") || Math.abs(winProb - 0.5) <= RIVAL_CLOSE_WINPROB_BAND;
}

// Recomputes each rival's `active` flag against the player's current overall.
// History (meetings/record) is untouched -- dormant just means "not eligible
// for a rival-redraw right now," not "forgotten."
function refreshRivalActivity(rivals, playerOverall, division) {
  return rivals.map((r) => {
    const entry = division.find((f) => f.id === r.id);
    if (!entry) return { ...r, active: false };
    return { ...r, active: Math.abs(entry.overall - playerOverall) <= RIVAL_OVR_DORMANCY_GAP };
  });
}

// =========================================================================
//  CAREER ARC (Phase 4): coach, off-cycle content, callouts, contract
// =========================================================================

// ---- Coach ----------------------------------------------------------------
// A relationship that deepens the longer you train under the same person --
// not a one-time pick, since Career Setup already trimmed every choice down
// to the ones that actually matter (see CareerSetupPanel). The coach is
// assigned automatically at the first camp, then levels up through camps
// actually spent training their specialty.
const COACH_SPECIALTIES = ["STRIKING", "GRAPPLING", "WRESTLING", "CARDIO", "POWER", "CHIN", "SPEED", "IQ"];

function assignCoach() {
  const specialty = COACH_SPECIALTIES[Math.floor(Math.random() * COACH_SPECIALTIES.length)];
  return { name: generateOpponentNames(1)[0], specialty, xp: 0, level: 0 };
}

// 60xp/level, capped at 5 (300xp to max) -- camps run once a year, so a
// fighter who focuses the coach's specialty every single year (35xp/camp:
// 20 base + 15 match bonus) maxes the relationship out around year 9,
// still inside a typical 8-11 year career instead of needing one longer
// than any career actually runs.
function coachLevelFor(xp) { return Math.min(5, Math.floor(xp / 60)); }

// ---- Off-cycle content ------------------------------------------------
// Media days and charity work -- distinct from fight-week mediaEvent
// (which is about handling THIS fight's trash talk) in that these aren't
// tied to any particular fight at all. What they build is fame: a
// popularity track separate from rankPoints, since a fighter can be a
// bigger draw than their ranking alone would suggest -- and it's what a
// Sponsor-Friendly contract (see below) actually pays out on.
function pickMediaDayLine(playedUp) {
  return playedUp
    ? "Media day. Full showman mode -- the cameras love it, the highlight reel writes itself."
    : "Media day. Straight answers, no bit -- some fans respect that more than the show.";
}

// ---- Contract -----------------------------------------------------------
// Three real shapes, not just a bigger number -- what you're actually
// betting on differs. Purse is denominated in $K per fight, scaled up
// hard by circuit tier (a Regional purse and a Premier purse shouldn't
// read anywhere close to the same), the same tier-aware weighting
// calculateLegacy already uses for legacy gain.
const CONTRACT_TYPES = [
  {
    id: "showMoney", label: "Show Money Deal",
    desc: "A steady guarantee every time you step in the cage. Smaller bonuses either way.",
    base: 8, winBonus: 4, finishBonus: 3, fameCut: 0.05,
  },
  {
    id: "payPerPerformance", label: "Pay-Per-Performance",
    desc: "Low guarantee, real money on the table if you win -- and finish.",
    base: 3, winBonus: 10, finishBonus: 8, fameCut: 0.05,
  },
  {
    id: "sponsorFriendly", label: "Sponsor-Friendly Deal",
    desc: "Modest guarantee and bonuses, but your own popularity pays out directly.",
    base: 5, winBonus: 5, finishBonus: 3, fameCut: 0.25,
  },
];
const DEFAULT_CONTRACT = { id: "regionalMinimum", label: "Regional Minimum", desc: "What every unsigned fighter starts on.", base: 1, winBonus: 1, finishBonus: 0.5, fameCut: 0.02 };

const TIER_PURSE_MULT = { "CLF Regional": 1, "CLF National": 3, "CLF Contender Series": 6, "CLF PREMIER": 20 };

function purseForFight(contract, tier, win, finished, fame) {
  const scale = TIER_PURSE_MULT[tier] ?? 1;
  let gain = contract.base * scale;
  if (win) gain += contract.winBonus * scale;
  if (win && finished) gain += contract.finishBonus * scale;
  gain += fame * contract.fameCut * scale * 0.1;
  return Math.round(gain);
}

// Resolves the one-time Premier contract negotiation triggered in
// commitFight. contractId picks from CONTRACT_TYPES; anything unrecognized
// falls back to Show Money rather than leaving the career on the regional
// minimum forever.
function resolveContractNegotiation(state, contractId) {
  const s = { ...state };
  const contract = CONTRACT_TYPES.find((c) => c.id === contractId) || CONTRACT_TYPES[0];
  s.contract = contract;
  s.contractNegotiated = true;
  s.timeline = [...s.timeline, { type: "contractSigned", id: `contract-${s.year}-${s.fightGlobalIndex}`, label: contract.label }];
  s.pendingDecision = null;
  return s;
}

function initCareer(picks, options) {
  const base = {};
  SKILL_KEYS.forEach((k) => { base[k] = picks[k].scoreValue; });
  const totalYears = 8 + Math.floor(Math.random() * 4);
  return {
    base, reachScore: picks.REACH.scoreValue,
    displayOverall: Math.round(ATTRS.reduce((s, a) => s + picks[a.key].scoreValue, 0) / ATTRS.length),
    totalYears, year: 1,
    fightsRemainingThisYear: 0,
    // Career setup carries these in; they shape the career but never touched
    // GOAT Score (that was decided at draft time).
    division: (options && options.division) || null,
    debutEra: (options && options.debutEra) || "2020s",
    actualHeight: (options && options.actualHeight) || null,
    actualReach: (options && options.actualReach) || null,
    // The persistent world: 15 ranked contenders + a champion who exist and
    // fight each other between your bouts.
    divisionRoster: buildDivision(),
    // playerRank is the real ladder position (0 = champion, 1-15 = ranked,
    // null = unranked) -- the single source of truth for anything the
    // player sees as "my ranking." peakPlayerRank is its high-water mark
    // (lower is better, so it tracks via Math.min, not Math.max -- see
    // commitFight). rankPoints stays as an internal, hidden continuous
    // value -- matchmaking calibration and a Legacy Score input -- it is
    // never shown to the player as a rank.
    playerRank: null, peakPlayerRank: null,
    record: { w: 0, l: 0 }, finishes: { ko: 0, sub: 0, dec: 0 },
    rankPoints: 0, peakRankPoints: 0, rankedFightCount: 0,
    circuitTier: "CLF Regional",
    // The highest tier ever REACHED -- tracked separately from circuitTier
    // because that can drop back to National after a Contender Series loss
    // (standings intact, per the tier-promotion comment below), and a
    // showcase-level run shouldn't get unwritten by finishing back where
    // it came from. Legacy scoring and the final verdict both key off this,
    // not the raw score alone -- see calculateLegacy/verdictFor.
    peakCircuitTier: "CLF Regional",
    careerStyle: (options && options.careerStyle) || "Balanced",
    styleIsNaturalFit: !!(options && options.careerStyle
      && options.careerStyle !== "Balanced"
      && options.careerStyle === bestFitArchetypeFlat(base)),
    // null, not 0 -- 0 is playerRank's own "champion" value, so a bare 0
    // default here would misrender as Top 5 (0 <= 5) for a fighter who
    // hasn't even fought yet. null correctly means "unranked/no fight
    // played this year" the same way playerRank itself uses it.
    yearStartRank: null, yearStartChampion: false, yearStartTier: "CLF Regional", yearStartLegacy: 0, peakYearLegacy: 0, peakYearNumber: 1,
    champion: false, titleReigns: 0, titleDefenses: 0,
    streak: 0, longestStreak: 0,
    // Scoped to CLF National wins only (see the National->Contender Series
    // gate in commitFight) -- never touched by Regional or Premier wins,
    // and never reset by a Contender Series loss bouncing back to National
    // (that's "standing intact," same as everything else at this tier).
    nationalWins: 0, nationalOppQualitySum: 0,
    wear: { chin: 0, speed: 0 }, weightPenaltyFightsLeft: 0,
    runningLegacy: 0, oppQualitySumWins: 0, statementWins: 0, rivalryWins: 0,
    rivals: [], recentOpponentIds: [], definingLoss: null,
    yearFocusAttr: null, yearStance: "balanced", campQuality: "full", mediaBuff: null,
    wonTitleAsUnderdog: false,
    // Phase 4 (Career Arc): a coach relationship that deepens over camps,
    // fame built through off-cycle content (feeds sponsor money), a real
    // purse, and the contract that decides how it gets paid out.
    coach: null,
    fame: 0,
    purse: 0,
    contract: DEFAULT_CONTRACT,
    contractNegotiated: false,
    timeline: [
      { type: "styleSelected", id: "style-select",
        style: (options && options.careerStyle) || "Balanced",
        naturalFit: !!(options && options.careerStyle
          && options.careerStyle !== "Balanced"
          && options.careerStyle === bestFitArchetypeFlat(base)) },
      { type: "year", id: "y-1", year: 1 },
    ],
    fightGlobalIndex: 0,
    pendingDecision: { type: "campPlanning" }, pendingFight: null,
    finished: false, legacyScore: 0, verdict: null, totalFightCount: 0,
  };
}

function resolveCampPlanning(state, { focusAttr, campQuality, stance }) {
  const s = { ...state };
  s.yearFocusAttr = focusAttr;
  s.campQuality = campQuality;
  s.yearStance = stance;
  // Snapshot rank/title status right as the year begins, so the year-end
  // recap can show what changed over the course of the year.
  s.yearStartRank = state.playerRank;
  s.yearStartChampion = state.champion;
  s.yearStartTier = state.circuitTier;
  s.yearStartLegacy = state.runningLegacy;

  const effective = applyAging(s.base, s.year, s.wear);
  const riskMult = campQuality === "full" ? 0.55 : 1.35;
  const injury = rollInjury(effective, riskMult);
  let fightsThisYear = 2 + Math.floor(Math.random() * 3);
  if (s.year > 8) fightsThisYear = Math.max(1, fightsThisYear - 1);
  if (campQuality === "full") fightsThisYear = Math.max(1, fightsThisYear - 1);

  // circuitTier/champion ride along too -- the "made the leap" read in the
  // UI needs to know whether a tier was already broken into, not just the
  // raw playerRank number, since that resets to null on every promotion.
  const timeline = [...s.timeline, { type: "campPlan", id: `plan-${s.year}`, year: s.year, focusAttr, campQuality, stance, rankSnapshot: state.playerRank, circuitTier: state.circuitTier, champion: state.champion }];
  let champion = s.champion;
  if (injury) {
    s.wear = { chin: s.wear.chin + (injury.major ? 3 : 1), speed: s.wear.speed + (injury.major ? 3 : 1) };
    if (injury.major) {
      fightsThisYear = 0;
      timeline.push({ type: "injury", id: `inj-${s.year}`, major: true });
      if (champion) {
        champion = false;
        // The belt doesn't just sit empty for a year -- flag the current
        // #1 contender as the real interim champion in the roster. Once
        // the player returns, the existing title-reclaim logic already
        // knows how to find and dethrone whoever's flagged isChampion (see
        // commitFight's isTitleShot-win branch, which now also demotes
        // them via demoteInDivision same as any other beaten former
        // champion) -- so fighting back for the real belt just works, no
        // separate interim-specific code path needed anywhere else.
        let interimName = null;
        if (s.divisionRoster && s.divisionRoster.length) {
          interimName = s.divisionRoster[0].name;
          s.divisionRoster = s.divisionRoster.map((f, i) => (i === 0 ? { ...f, isChampion: true } : f));
        }
        timeline.push({ type: "interim", id: `int-${s.year}`, interimName });
      }
    } else {
      fightsThisYear = Math.max(1, fightsThisYear - 1);
      timeline.push({ type: "injury", id: `inj-${s.year}`, major: false });
    }
  }

  s.champion = champion;

  // Weight-class move used to apply itself silently and unconditionally --
  // a 1-in-20 chance every year, no warning, wiping rank/rankPoints/title
  // status the instant it rolled true. A player could have a real 9-1 run
  // going, never see it coming, and have no idea why they were suddenly
  // "Unranked" again. Now it's an offer, not a fait accompli: the roll
  // still decides whether the opportunity comes up at all, but applying it
  // -- and eating the reset that comes with it -- is the player's call,
  // same as every other career decision. See resolveWeightMoveOffer.
  let weightMoveOffer = null;
  if (s.weightPenaltyFightsLeft <= 0 && Math.random() < 0.05) {
    const classIdx = WEIGHT_CLASSES.indexOf(s.division);
    const canGoUp = classIdx !== -1 && classIdx < WEIGHT_CLASSES.length - 1;
    const canGoDown = classIdx !== -1 && classIdx > 0;
    if (canGoUp || canGoDown) {
      const direction = canGoUp && (!canGoDown || Math.random() < 0.5) ? "up" : "down";
      const targetDivision = WEIGHT_CLASSES[direction === "up" ? classIdx + 1 : classIdx - 1];
      weightMoveOffer = { direction, targetDivision };
    }
  }

  // Coach: assigned the first time camp planning ever runs, then levels up
  // with every camp -- faster when this year's focus matches their
  // specialty, since that's the whole relationship actually being used.
  if (!s.coach) {
    s.coach = assignCoach();
    timeline.push({ type: "coachAssigned", id: `coach-${s.year}`, name: s.coach.name, specialty: s.coach.specialty });
  } else {
    const focusMatch = focusAttr === s.coach.specialty;
    const xpGain = 20 + (focusMatch ? 15 : 0);
    const levelBefore = s.coach.level;
    const xp = s.coach.xp + xpGain;
    const level = coachLevelFor(xp);
    s.coach = { ...s.coach, xp, level };
    if (level > levelBefore) {
      timeline.push({ type: "coachLevelUp", id: `coachlvl-${s.year}`, name: s.coach.name, level });
    }
  }

  s.timeline = timeline;
  s.fightsRemainingThisYear = fightsThisYear;
  s.pendingDecision = weightMoveOffer ? { type: "weightMoveOffer", ...weightMoveOffer } : null;
  return s;
}

// Accepting moves divisions for real: new division name, a freshly built
// roster (a different weight class's Top 15 has nothing to do with the one
// just left behind), and starting back at the bottom there -- rank,
// rankPoints, and a held title don't follow you across weight classes any
// more than they would in real life. The circuit tier itself (Regional/
// National/Premier) is untouched -- this is a lateral move, not a
// promotion or demotion. Declining costs nothing -- same division, same
// standing, camp just moves on.
function resolveWeightMoveOffer(state, accept) {
  const s = { ...state };
  if (accept) {
    const { direction, targetDivision } = state.pendingDecision;
    s.division = targetDivision;
    s.divisionRoster = buildDivision();
    s.playerRank = null;
    s.rankPoints = 0;
    s.champion = false;
    s.weightPenaltyFightsLeft = 2;
    s.timeline = [...s.timeline, { type: "weightMove", id: `wm-${s.year}-${s.fightGlobalIndex}`, direction, division: s.division }];
  } else {
    s.timeline = [...s.timeline, { type: "weightMoveDeclined", id: `wmd-${s.year}-${s.fightGlobalIndex}`, division: s.division }];
  }
  s.pendingDecision = null;
  return s;
}

// Rare, non-fight decision points. Capped chances so they feel special
// rather than constant, and title fights always skip straight to the fight.
function maybeFightChoice(state) {
  // Contender Series is a short, focused stretch -- no camp-planning
  // distractions or random events, just the one showcase fight (see
  // prepareFight's "contenderSeries" branch) standing between here and
  // the Premier contract.
  if (state.circuitTier === "CLF Contender Series") return prepareFight(state, "contenderSeries");
  // Mirrors prepareFight's isTitleShot gate exactly -- must stay in sync,
  // or this could skip straight to what it thinks is a title fight while
  // prepareFight itself decides otherwise (or vice versa).
  const wouldBeTitle = state.champion || (!state.champion && state.streak >= 2 && state.playerRank != null && state.playerRank <= 5);
  if (wouldBeTitle) return prepareFight(state, "default");
  const roll = Math.random();
  if (roll < 0.22) {
    // Computed once, right here -- fixed for the life of this decision
    // (same convention as trainingEvent's attr below), not re-rolled on
    // every render.
    const options = generateMatchmakerOptions(state.divisionRoster, state.rankPoints, state.recentOpponentIds, state.circuitTier);
    return { ...state, pendingDecision: { type: "fightChoice", options } };
  }
  if (roll < 0.30) return { ...state, pendingDecision: { type: "trainingEvent", attr: pickWeakestSkill(state.base) } };
  if (roll < 0.36) return { ...state, pendingDecision: { type: "mediaEvent" } };
  // Off-cycle content -- not tied to any particular fight, just building
  // fame between them. Kept rare (4% total) so it reads as a real event,
  // not a third flavor of the fight-week media roll above.
  if (roll < 0.38) return { ...state, pendingDecision: { type: "offCycleEvent" } };
  return prepareFight(state, "default");
}

function pickWeakestSkill(base) {
  let worst = { key: "STRIKING", value: 999 };
  SKILL_KEYS.forEach((k) => { if (base[k] < worst.value) worst = { key: k, value: base[k] }; });
  return worst.key;
}

// A real trade either way -- "Address It" used to be a free permanent
// stat with no cost at all, which made "Stay the Course" pointless. Now
// both options cost something and gain something, just on different
// timescales: shore up the weakness permanently at the cost of a sliver
// of your strengths, or bank a one-fight sharpness edge on your best
// weapon by keeping camp rhythm intact instead.
function resolveTrainingEvent(state, attr, addressed) {
  const s = { ...state };
  if (addressed) {
    s.base = { ...s.base, [attr]: clamp(s.base[attr] + 3, 30, 99) };
    // Extra mat time on the weak spot comes from somewhere -- the two
    // attributes furthest ahead of it take a small permanent hit. Pulling
    // from strengths (not other weaknesses, like camp planning's own focus
    // trade-off does) keeps this feeling like a different mechanic, not a
    // second copy of the same one.
    const strongest = SKILL_KEYS.filter((k) => k !== attr)
      .sort((a, b) => s.base[b] - s.base[a])
      .slice(0, 2);
    strongest.forEach((k) => { s.base = { ...s.base, [k]: clamp(s.base[k] - 1, 30, 99) }; });
  } else {
    // Staying the course keeps camp rhythm intact -- a one-fight sharpness
    // bump to the fighter's current best weapon for the very next fight,
    // instead of gambling mat time patching the weak spot. Shares the same
    // one-fight buff slot fight-week media handling uses (see
    // resolveMediaEvent) -- both represent "what's dialed in for the next
    // walkout," so if both somehow fire before the next fight, the more
    // recent one is what carries in, same as it already works today.
    const best = SKILL_KEYS.reduce((a, b) => (s.base[b] > s.base[a] ? b : a));
    s.mediaBuff = { attr: best, delta: 3 };
  }
  s.timeline = [...s.timeline, { type: "trainingEvent", id: `train-${s.year}-${s.fightGlobalIndex}`, attr, addressed }];
  s.pendingDecision = null;
  return s;
}

// A one-fight-only buff depending on how the player handles the hype/trash talk.
function resolveMediaEvent(state, fireBack) {
  const s = { ...state };
  s.mediaBuff = fireBack ? { attr: "POWER", delta: 4 } : { attr: "IQ", delta: 3 };
  s.timeline = [...s.timeline, { type: "mediaEvent", id: `media-${s.year}-${s.fightGlobalIndex}`, fireBack }];
  s.pendingDecision = null;
  return s;
}

// Off-cycle content: Media Day builds fame fast at a small stat cost
// (skipping camp time for the cameras); Charity Work builds fame slower
// but with no cost at all -- goodwill instead of a highlight reel. Neither
// is tied to a fight; this is what actually grows the fame track that a
// Sponsor-Friendly contract pays out on (see purseForFight).
function resolveOffCycleEvent(state, choice) {
  const s = { ...state };
  if (choice === "mediaDay") {
    s.fame = clamp(s.fame + 8, 0, 100);
    const worst = pickWeakestSkill(s.base);
    s.base = { ...s.base, [worst]: clamp(s.base[worst] - 1, 30, 99) };
  } else {
    s.fame = clamp(s.fame + 4, 0, 100);
  }
  s.timeline = [...s.timeline, { type: "offCycleEvent", id: `offcycle-${s.year}-${s.fightGlobalIndex}`, choice, fameAfter: s.fame }];
  s.pendingDecision = null;
  return s;
}

// Sets up everything a fight needs -- opponent selection, hype rolls, the
// camp/style/media modifiers baked into "effective" stats, and a real odds
// preview -- but does NOT roll the outcome. That happens in commitFight,
// once the player has actually seen the pre-fight screen (opponent, odds,
// fight-week flavor, trash talk) and chosen to go through with it.
// Splitting these apart is what makes a pre-fight buildup possible at all:
// previously opponent selection and the coin flip happened in the same
// atomic call, so there was never a moment where "who's next" was known
// but "who won" wasn't.
function prepareFight(state, choiceTag, targetId) {
  const s = { ...state };
  s.fightGlobalIndex += 1;

  // Contender Series is a one-off showcase against someone else also
  // trying to break in -- not a title fight, not a ranked-ladder booking,
  // and nobody there can ever become a rival (there's no persistent
  // roster to re-meet them in).
  const isContenderSeriesFight = choiceTag === "contenderSeries";
  const isCallout = choiceTag === "callout" && !!targetId;
  // The matchmaking panel now shows 3 real, named candidates (see
  // generateMatchmakerOptions) instead of a hidden difficulty label --
  // picking one passes its id through here so the fight that happens is
  // exactly the fighter the player saw and picked, not a fresh re-draw.
  const isMatchmakerPick = !!targetId && (choiceTag === "easy" || choiceTag === "ranked" || choiceTag === "stepUp");
  // Gated on playerRank (the real division ladder), not rankPoints --
  // rankPoints is farmable via wins that never touch a ranked opponent, so
  // it used to let a fighter qualify for a title shot without ever having
  // beaten anyone actually ranked. playerRank can only move by beating a
  // ranked opponent, so this now genuinely requires having climbed the
  // ladder into the top 5, on top of the existing streak requirement.
  const isTitleShot = !isContenderSeriesFight && !isCallout && ((!s.champion && s.streak >= 2 && s.playerRank != null && s.playerRank <= 5) || choiceTag === "shortNoticeTitle" || choiceTag === "demandShot");
  const isTitleDefense = !isContenderSeriesFight && !isCallout && s.champion;
  const isTitleFight = isTitleShot || isTitleDefense;

  const agedNow = applyAging(s.base, s.year, s.wear);
  const playerOverallNow = Math.round(SKILL_KEYS.reduce((sum, k) => sum + agedNow[k], 0) / SKILL_KEYS.length);

  let picked, isRivalFight = false;
  if (isContenderSeriesFight) {
    picked = { fighter: generateContenderSeriesOpponent(), rank: null };
  } else if (isCallout) {
    // Called-out fight: the player is naming a specific ranked contender
    // instead of taking whatever matchmaking offers -- a real statement,
    // so it's scored like one (see the legacy bonus/penalty in
    // commitFight). Champion is off-limits here on purpose: calling out
    // the belt IS a title shot, and that already has its own real path
    // (streak+ranking, or Demand/Short-Notice) with its own stakes.
    const target = s.divisionRoster.find((f) => f.id === targetId && !f.isChampion);
    picked = target ? { fighter: target, rank: displayRankFor(s.divisionRoster, s.divisionRoster.indexOf(target)) } : selectDivisionOpponent(s.divisionRoster, s.rankPoints, false, s.recentOpponentIds, undefined, s.circuitTier);
  } else if (isMatchmakerPick) {
    const target = s.divisionRoster.find((f) => f.id === targetId);
    // Falls back to a fresh draw with the same difficulty bias if the
    // targeted fighter somehow isn't in the roster anymore (e.g. the
    // division regenerated between the offer being shown and picked --
    // shouldn't happen inside one decision, but never leave the player
    // stuck on a dead pick).
    picked = target ? { fighter: target, rank: displayRankFor(s.divisionRoster, s.divisionRoster.indexOf(target)) } : selectDivisionOpponent(s.divisionRoster, s.rankPoints, false, s.recentOpponentIds, choiceTag, s.circuitTier);
  } else {
    // Draw the opponent from the persistent division: a real fighter with a
    // standing record, not a throwaway profile. An active rival can be drawn
    // for a rematch -- but only an ACTIVE one: re-validate every rival against
    // the player's current strength before considering a redraw, so a rival
    // from years-outgrown tiers stops being reachable instead of getting
    // rebooked against a PREMIER-tier fighter forever.
    s.rivals = refreshRivalActivity(s.rivals || [], playerOverallNow, s.divisionRoster);
    // Only actual EARNED rivals are eligible for a redraw -- s.rivals also
    // holds one-meeting entries that haven't crossed the isRival threshold
    // yet, and those must never get the 40%-redraw shortcut (that's exactly
    // how a random one-off opponent turns into an immediate, unearned rematch).
    const activeRivals = s.rivals.filter((r) => r.active && r.isRival);
    const rivalEntry = activeRivals.length && !isTitleFight
      ? s.divisionRoster.find((f) => f.id === activeRivals[Math.floor(Math.random() * activeRivals.length)].id)
      : null;
    const drawRival = rivalEntry && Math.random() < 0.4;
    picked = drawRival
      ? { fighter: rivalEntry, rank: s.divisionRoster.indexOf(rivalEntry) }
      : selectDivisionOpponent(s.divisionRoster, s.rankPoints, isTitleFight, s.recentOpponentIds, choiceTag, s.circuitTier);
  }
  const oppEntry = picked.fighter;
  const oppName = oppEntry.name;
  const oppRank = picked.rank;
  const opp = { attrs: oppEntry.attrs, overall: oppEntry.overall, archetype: oppEntry.archetype, traits: oppEntry.traits };
  const oppRecord = oppEntry.record;
  if (!isContenderSeriesFight) {
    const existingRival = s.rivals.find((r) => r.id === oppEntry.id);
    isRivalFight = !!(existingRival && existingRival.isRival);
  }

  let hype = null;
  if ((isTitleFight || isRivalFight) && Math.random() < 0.4) {
    hype = rollHypeEvent(s.base.IQ, isTitleFight, isRivalFight);
  }

  // Reuse the aging pass already computed above for the rival-dormancy check
  // instead of recomputing the identical thing.
  let effective = agedNow;
  if (s.yearFocusAttr) {
    // Focusing one attribute costs mat time elsewhere: +4 to the focus, -1 to
    // the two weakest OTHER attributes. Without a cost, taking the focus every
    // year would be strictly correct and therefore not a decision at all.
    // A coach whose specialty matches adds their level on top -- the payoff
    // for actually training with the same person year after year.
    const coachBonus = (s.coach && s.coach.specialty === s.yearFocusAttr) ? s.coach.level : 0;
    effective = { ...effective, [s.yearFocusAttr]: clamp(effective[s.yearFocusAttr] + 4 + coachBonus, 30, 99) };
    const others = SKILL_KEYS.filter((k) => k !== s.yearFocusAttr)
      .sort((a, b) => effective[a] - effective[b])
      .slice(0, 2);
    others.forEach((k) => { effective = { ...effective, [k]: clamp(effective[k] - 1, 30, 99) }; });
  }
  if (hype) effective = { ...effective, [hype.attr]: clamp(effective[hype.attr] + hype.delta, 30, 99) };
  if (s.mediaBuff) effective = { ...effective, [s.mediaBuff.attr]: clamp(effective[s.mediaBuff.attr] + s.mediaBuff.delta, 30, 99) };
  if (s.weightPenaltyFightsLeft > 0) {
    effective = { ...effective, CARDIO: clamp(effective.CARDIO - 4, 30, 99), POWER: clamp(effective.POWER - 3, 30, 99) };
  }
  // Playing to your natural-fit style is a real, felt bonus -- not flavor.
  if (s.styleIsNaturalFit && s.careerStyle) {
    const styleArchetype = ARCHETYPES.find((a) => a.name === s.careerStyle);
    if (styleArchetype) {
      Object.keys(styleArchetype.mult).forEach((k) => {
        if (styleArchetype.mult[k] > 1) effective = { ...effective, [k]: clamp(effective[k] + 3, 30, 99) };
      });
    }
  }
  const playerTraits = deriveTraits(effective);
  const stanceBias = s.yearStance === "ground" ? 0.08 : s.yearStance === "standup" ? -0.08 : 0;

  // Pre-fight odds -- the exact same deterministic computation resolveFight
  // itself will use a moment later at commit time, so what's shown here is
  // guaranteed to match what actually decides the fight, not a second,
  // possibly-drifted estimate.
  const preview = computeFightPreview(effective, s.reachScore, opp.attrs, stanceBias, playerTraits, opp.traits);

  s.pendingDecision = { type: "preFight" };
  s.pendingFight = {
    choiceTag, isTitleShot, isTitleDefense, isTitleFight, isCallout,
    oppEntry, oppName, oppRank, opp, oppRecord,
    hype, effective, playerTraits, stanceBias, playerOverallNow,
    winProb: preview.winProb, matchup: preview.matchup,
    fightWeekLine: buildFightWeekLine(s, isTitleFight, isRivalFight, isContenderSeriesFight, isCallout),
    trashTalk: buildTrashTalk(oppName, preview.winProb, isTitleFight, isRivalFight, isContenderSeriesFight, isCallout),
    youOdds: formatOdds(preview.winProb), oppOdds: formatOdds(1 - preview.winProb),
  };
  return s;
}

// Resolves a fight that prepareFight already set up -- the actual coin
// flip, then every bit of post-fight bookkeeping (record, rankings, the
// persistent division, rivalries, bonuses, legacy, the timeline entry).
// Reads its setup from state.pendingFight rather than recomputing any of
// it, so the fight that happens is exactly the one the pre-fight screen
// showed -- same opponent, same odds.
function commitFight(state) {
  if (!state.pendingFight) return state;
  const s = { ...state };
  const pf = s.pendingFight;
  const {
    choiceTag, isTitleShot, isTitleDefense, isTitleFight, isCallout,
    oppEntry, oppName, oppRank, opp, oppRecord,
    hype, effective, playerTraits, stanceBias, playerOverallNow,
  } = pf;
  const isContenderSeriesFight = choiceTag === "contenderSeries";

  const tierBefore = s.circuitTier;
  const totalRounds = isTitleFight ? 5 : 3;
  const result = resolveFight(effective, s.reachScore, opp.attrs, stanceBias, playerTraits, opp.traits, totalRounds);
  // stats/rounds come straight from the round-by-round simulation itself
  // now (see simulateRounds) rather than a separate post-hoc fabrication --
  // read here (rather than only inline in the timeline push below) so the
  // performance-bonus check below can see finishRound before legacyDelta
  // is finalized.
  const { stats, rounds } = result;

  if (result.win) {
    s.record = { ...s.record, w: s.record.w + 1 };
    s.streak += 1;
    s.longestStreak = Math.max(s.longestStreak, s.streak);
    if (result.method === "KO/TKO") s.finishes = { ...s.finishes, ko: s.finishes.ko + 1 };
    else if (result.method === "Submission") s.finishes = { ...s.finishes, sub: s.finishes.sub + 1 };
    else s.finishes = { ...s.finishes, dec: s.finishes.dec + 1 };
    s.oppQualitySumWins += opp.overall;
    if (tierBefore === "CLF National") { s.nationalWins += 1; s.nationalOppQualitySum += opp.overall; }
  } else {
    s.record = { ...s.record, l: s.record.l + 1 };
    s.streak = 0;
  }

  // Snapshot rank/title status right before this fight moves the needle, so
  // the fight card can show what actually changed -- same idea as
  // yearStartRank/yearStartChampion for the year-end recap, just scoped to
  // one fight instead of one year.
  const rankPointsBefore = s.rankPoints;
  const championBefore = s.champion;
  const playerRankBefore = s.playerRank;

  s.rankPoints = updateRanking(s.rankPoints, result.win, opp.overall, isTitleFight);
  s.peakRankPoints = Math.max(s.peakRankPoints, s.rankPoints);
  // A fight counts toward Legacy's "ranked competition" bonus because the
  // player already held a ranked position going in, or the opponent
  // actually did (a callout upset over a ranked name counts even from
  // Unranked) -- not because the internal rankPoints value crossed a
  // threshold, which could be farmed with wins that never touched the real
  // ladder at all.
  if (playerRankBefore != null || (oppRank != null && oppRank > 0)) s.rankedFightCount += 1;

  if (isTitleShot && result.win) {
    s.titleReigns += 1;
    s.champion = true;
    if (s.record.l >= 2) s.wonTitleAsUnderdog = true;
  }
  if (isTitleDefense) {
    if (result.win) s.titleDefenses += 1;
    else s.champion = false;
  }
  // Snapshotted here, before a tier promotion (if this fight just triggered
  // one) resets rankPoints/champion for the next tier's fresh climb -- the
  // fight card should always show what actually happened in THIS fight
  // (e.g. winning the Regional title -> "Champion"), not the next tier's
  // clean slate. That reset is its own story, told by the circuitMove card
  // right after this one.
  const rankPointsAfterFight = s.rankPoints;
  const championAfterFight = s.champion;

  // --- tier promotion ---------------------------------------------------
  // A one-way climb -- Regional -> National -> Contender Series -> Premier
  // -- gated by real accomplishment at each level, with two legitimate
  // routes at Regional and National alike: winning that tier's title (the
  // prestige route), or a real performance-based case that a promotion
  // would plausibly notice (the prospect route) -- see the Model E
  // structural-prototype pass this implements. Contender Series has no
  // ladder of its own: win the single showcase fight and the Premier
  // contract is waiting; lose it and it's back to National to build the
  // case again, standings intact. No demotion once a tier is broken into
  // -- a rough patch in Premier doesn't send you back to Regional, same as
  // the real thing.
  const justWonTierTitle = isTitleShot && result.win;
  // National's alternate route needs "beat National-level opposition," not
  // just "win at National" -- s.nationalWins/nationalOppQualitySum are
  // scoped to CLF National wins only (incremented below, gated on
  // tierBefore, so a Regional win can never feed this average). They are
  // NOT reset on a Contender Series loss bouncing back to National -- that
  // branch is explicitly "standing intact," and the credibility already
  // earned this National run carries through a failed showcase attempt,
  // not just the fights since the bounce-back. This is the interpretation
  // the Model E prototype simulated and reported as approved.
  const nationalGatePass = s.nationalWins >= 2 && (s.nationalOppQualitySum / Math.max(1, s.nationalWins)) >= 65;
  let resetForFreshTier = false;
  // True only for the National -> Contender Series branch below: champion
  // gets cleared without a fresh-tier reset (the National roster/standing
  // is kept, not rebuilt), so the belt-taking block further down needs its
  // own guard against re-crowning the player right after this clears them.
  let leftBeltBehindForContenderSeries = false;
  if (s.circuitTier === "CLF Regional" && (justWonTierTitle || s.streak >= 4)) {
    s.circuitTier = "CLF National";
    resetForFreshTier = true;
  } else if (s.circuitTier === "CLF National" && (justWonTierTitle || nationalGatePass)) {
    s.circuitTier = "CLF Contender Series";
    // Contender Series is "just another fighter trying to get in" -- no
    // title, no rank, no matter how you earned the invite. Winning the
    // National title itself sets s.champion=true a few lines up, above;
    // clear it back off here so it can't leak into the showcase fight, or
    // (worse) ride all the way back into National on a loss -- the belt
    // was left behind the moment the Contender Series invite was accepted,
    // whether or not the showcase itself goes your way.
    s.champion = false;
    leftBeltBehindForContenderSeries = true;
    // playerRank comes down with it -- best-in-division but not literally
    // holding a belt you walked away from, same standing as any other
    // former champion (see demoteInDivision's "modest drop" elsewhere).
    // Set directly here rather than left to the belt-taking block below:
    // that block is guarded off for this case (see
    // leftBeltBehindForContenderSeries below) specifically because it
    // would otherwise set playerRank back to 0 right after champion was
    // just cleared to false two lines up -- Rankings tab reading "you're
    // the champion" while the summary line says Unranked, which is
    // exactly the desync that got reported. Covers both ways in here: a
    // fresh title win this same fight (justWonTierTitle -- playerRank
    // hasn't been touched yet, still whatever it was beforehand), or
    // already being champion on a defense win that also happened to hit
    // the streak>=3 gate (championBefore -- playerRank is already 0).
    if (justWonTierTitle || championBefore) s.playerRank = 1;
  } else if (s.circuitTier === "CLF Contender Series") {
    s.circuitTier = result.win ? "CLF PREMIER" : "CLF National";
    resetForFreshTier = result.win;
  }
  const tierChanged = s.circuitTier !== tierBefore;
  // First real contract: the moment you actually make Premier is when the
  // promotion sits you down with a real deal, not before -- everyone
  // starts on the same regional minimum. Guarded by contractNegotiated so
  // it can only ever fire once per career.
  const triggerContractNegotiation = s.circuitTier === "CLF PREMIER" && tierBefore !== "CLF PREMIER" && !s.contractNegotiated;
  // Peak reached is a high-water mark, never unwritten by a later bounce
  // back down (Contender Series -> National on a loss is the one case
  // that can happen -- see above).
  if (CLF_TIER_ORDER.indexOf(s.circuitTier) > CLF_TIER_ORDER.indexOf(s.peakCircuitTier)) {
    s.peakCircuitTier = s.circuitTier;
  }
  if (resetForFreshTier) {
    // Fresh climb at the new level -- you're a nobody again, same as
    // stepping up a weight class in real life. A Contender Series loss
    // bouncing back to National is deliberately NOT here: that keeps the
    // National standing already earned instead of erasing it.
    s.divisionRoster = buildDivision();
    s.playerRank = null;
    s.champion = false;
    // Premier entry alone seeds rankPoints instead of the usual 0 -- a
    // Contender Series win earned real credibility, so matchmaking starts
    // mid-pack rather than at the very bottom. Deliberately NOT a Top 15
    // slot: playerRank stays null (set just above) and matchmaking at
    // rankPoints=40 still centres well outside the ranked window (see
    // selectDivisionOpponent) -- the player still has to beat their way
    // onto the board, same as any other tier. Regional -> National and
    // National -> Contender Series both stay at 0: this seed is scoped to
    // the Premier boundary only, per the approved Model E V1 pass.
    s.rankPoints = s.circuitTier === "CLF PREMIER" ? 40 : 0;
    // Win streak resets too -- otherwise a streak built beating up the tier
    // you just left over-qualifies you for the next one on day one (e.g. a
    // 4-fight streak that won the Regional title would, left alone, already
    // satisfy National's streak>=5 Contender Series gate one fight later).
    s.streak = 0;
  }

  // --- update the persistent division -----------------------------------
  // Your opponent's record changes from fighting you, then the rest of the
  // division fights among itself so the standings move while you're away.
  // Skipped for a Contender Series fight -- that opponent isn't part of
  // any persistent roster, and the division above (National, in this
  // case) shouldn't move on a fight it wasn't actually part of.
  if (!isContenderSeriesFight) {
    let nextDivision = s.divisionRoster.map((f) => (
      f.id === oppEntry.id
        ? {
            ...f,
            record: { w: f.record.w + (result.win ? 0 : 1), l: f.record.l + (result.win ? 1 : 0) },
            recentForm: [result.win ? "L" : "W", ...(f.recentForm || [])].slice(0, 5),
          }
        : f
    ));
    // Beating someone ranked above you moves you toward their spot -- but
    // capped, so one callout upset over the #1 contender doesn't teleport a
    // total unknown straight to #1. Even a shocking win only climbs so far
    // in one night; closing a big gap takes several real wins, not one.
    // The cap itself still holds for a normal, nearby-rank win (unchanged
    // from before) -- it only widens for a genuine mismatch, and a finish
    // adds one further place on top of that -- opponent quality is the
    // primary driver, performance a small modifier, never the reverse.
    // Always floored at oppRank: a single win can never rank you better
    // than the person you just beat.
    if (result.win && oppRank > 0) {
      const startRank = s.playerRank != null ? s.playerRank : DIVISION_SIZE + 1;
      if (oppRank < startRank) {
        const gap = startRank - oppRank;
        const mismatchBonus = gap >= 13 ? 5 : gap >= 9 ? 3 : gap >= 6 ? 1 : 0;
        const isFinish = result.method === "KO/TKO" || result.method === "Submission";
        const climb = 5 + mismatchBonus + (isFinish ? 1 : 0);
        s.playerRank = Math.max(oppRank, startRank - climb);
      }
    } else if (!result.win && s.playerRank != null) {
      s.playerRank = Math.min(DIVISION_SIZE, s.playerRank + 1);
    }
    // Guarded against resetForFreshTier: winning the Regional (or Contender
    // Series) title just rebuilt s.divisionRoster into the NEXT tier's own
    // fresh roster a few lines up, and reset s.champion/s.playerRank back to
    // a clean slate on purpose -- a nobody again, same as stepping up a
    // weight class. Without this guard, this block re-applied the OLD
    // tier's title win on TOP of that reset (nextDivision was already the
    // new roster by this point): it stripped the new tier's own champion
    // and crowned the player over them, unearned, before they'd fought a
    // single fight there. oppEntry also belongs to the tier just left
    // behind, so none of these lookups even resolve against the new roster.
    // Also guarded against leftBeltBehindForContenderSeries: that branch
    // above already cleared s.champion and set the correct playerRank for
    // a National title won on the way into Contender Series -- letting
    // this block re-run on top of it would set playerRank back to 0 right
    // after champion was cleared to false, the exact desync this whole
    // guard exists to prevent.
    if (!resetForFreshTier && !leftBeltBehindForContenderSeries) {
      if (isTitleShot && result.win) {
        // You took the belt -- clear isChampion off the old champ (found by
        // flag, not position) so they fall back into the ranked pool as a
        // normal contender with their real record intact. The player's own
        // champion status lives on career state (s.champion), never as a
        // divisionRoster entry, so rankings render must check that flag first.
        // They also get moved out of the reserved index-0 slot -- left there,
        // index 0 becomes a frozen "vacant champion" seat nothing else ever
        // draws into, and the very next title defense would end up rebooked
        // against the exact fighter the player just dethroned. A beaten
        // former champion is still elite, so the drop is modest.
        const exChampIdx = nextDivision.findIndex((f) => f.isChampion);
        nextDivision = nextDivision.map((f) => (f.isChampion ? { ...f, isChampion: false } : f));
        if (exChampIdx !== -1) nextDivision = demoteInDivision(nextDivision, exChampIdx, 3);
        s.playerRank = 0;
      } else if (isTitleDefense && !result.win) {
        // You lost the belt -- the opponent who just beat you becomes champion.
        // (s.playerRank already moved to 1 above, same as any other title loss.)
        nextDivision = nextDivision.map((f) => (f.id === oppEntry.id ? { ...f, isChampion: true } : f));
      } else if (isTitleDefense && result.win) {
        // You defended -- the challenger who just lost needs to rebuild
        // before getting another crack at the title, same as real UFC
        // booking. A bigger drop than the ex-champion case above: this
        // fighter didn't hold the belt, they just lost a title fight.
        const challengerIdx = nextDivision.findIndex((f) => f.id === oppEntry.id);
        if (challengerIdx !== -1) nextDivision = demoteInDivision(nextDivision, challengerIdx, 6);
      }
    }
    s.divisionRoster = simulateDivisionRound(nextDivision);
  }

  // playerRank is fully settled for this fight now (climb/drop above, the
  // champion-swap block just above that, and -- for a title-winning fight
  // that also triggers a tier promotion -- the fresh-tier reset earlier in
  // this function all had their say). Snapshot it for the fight card.
  const playerRankAfterFight = s.playerRank;
  // Fold it into the career-long high-water mark: lower is better here (0 =
  // champion), so this tracks via min, not max. Use championAfterFight (the
  // pre-reset flag) rather than the post-reset s.playerRank directly -- a
  // title win that ALSO triggers a same-fight tier promotion already
  // zeroed s.playerRank back to null for the fresh climb by this point, but
  // the player genuinely did hold the belt this fight and that peak is
  // real regardless of what the very next tier resets it to.
  const peakCandidate = championAfterFight ? 0 : s.playerRank;
  if (peakCandidate != null) {
    s.peakPlayerRank = s.peakPlayerRank == null ? peakCandidate : Math.min(s.peakPlayerRank, peakCandidate);
  }

  // A rivalry is earned: 2+ meetings, at least one of them genuinely
  // competitive. Tracked as a proper record per opponent (id-keyed, not
  // name equality) so multiple rivals can be active at once, each with
  // their own meeting count and head-to-head record.
  const fightWasClose = isCloseFight(result.method, result.winProb);
  let rivalryJustBorn = false;
  let isRivalry = false;
  // A Contender Series opponent is a one-off (there's no persistent roster
  // to ever re-meet them in), so they're never worth tracking as a rival.
  if (!isContenderSeriesFight) {
    const rivalIdx = s.rivals.findIndex((r) => r.id === oppEntry.id);
    if (rivalIdx === -1) {
      s.rivals = [...s.rivals, {
        id: oppEntry.id, name: oppName, meetings: 1,
        wins: result.win ? 1 : 0, losses: result.win ? 0 : 1,
        active: true, everClose: fightWasClose, isRival: false,
      }];
    } else {
      const r = s.rivals[rivalIdx];
      const meetings = r.meetings + 1;
      const everClose = r.everClose || fightWasClose;
      const isRival = r.isRival || (meetings >= RIVAL_MIN_MEETINGS && everClose);
      rivalryJustBorn = isRival && !r.isRival;
      s.rivals = s.rivals.map((x, i) => (i === rivalIdx ? {
        ...x, meetings, everClose, isRival,
        wins: x.wins + (result.win ? 1 : 0), losses: x.losses + (result.win ? 0 : 1),
      } : x));
    }
    // Also require `active`: normal (non-redraw) matchmaking has no idea who's
    // an old rival, so it can still coincidentally land on one. If the player
    // has outgrown them since, the meeting still counts toward their history,
    // but the fight itself shouldn't wear a RIVALRY tag for a matchup that's
    // really just a dormant former rival turning up by chance.
    const rivalRecord = s.rivals.find((r) => r.id === oppEntry.id);
    isRivalry = !!(rivalRecord && rivalRecord.isRival && rivalRecord.active);
  }
  s.recentOpponentIds = [oppEntry.id, ...(s.recentOpponentIds || [])].slice(0, 2);
  const isStatement = result.win && opp.overall >= 88;
  if (isStatement) s.statementWins += 1;
  if (isRivalry && result.win) s.rivalryWins += 1;
  // Fame builds off-cycle (media days, charity work) but also off the
  // fights that actually make noise -- a statement win, a rivalry blowoff,
  // a called-out fight, or the kind of finish that earns a bonus. A quiet
  // decision over a nobody doesn't move it either way.
  let fameGain = 0;
  if (isStatement) fameGain += 4;
  if (isRivalry) fameGain += 3;
  if (isCallout) fameGain += 3;
  if (result.win && stats.finishRound != null && stats.finishRound <= 2) fameGain += 2;
  if (fameGain > 0) s.fame = clamp(s.fame + fameGain, 0, 100);

  // Performance bonuses, UFC-style: a genuinely emphatic early finish earns
  // "Performance of the Night" (win-only -- you have to finish it); a real
  // nail-biter that goes the distance earns "Fight of the Night" regardless
  // of who won, since that one is about the fight, not the result. Round 1
  // alone would be too narrow a bar now that round-by-round momentum means
  // most finishes land once real damage has built up (round 2+, not round
  // 1) -- round 1 or 2 with a decisive winProb gap keeps "emphatic" honest
  // (a quick finish, not a grind) without making the badge nearly
  // impossible to ever see in a career.
  const dominance = Math.abs(result.winProb - 0.5) * 2; // 0 = coin flip, 1 = lopsided
  const isEmphaticFinish = stats.finishRound != null && stats.finishRound <= 2 && dominance >= 0.55;
  const isNailBiter = stats.finishRound == null && Math.abs(result.winProb - 0.5) <= 0.08;
  const bonusType = (result.win && isEmphaticFinish) ? "performance" : (isNailBiter ? "fotn" : null);
  // Betting odds are shown before the fight now (see prepareFight) --
  // winning as a real underdog against the odds the player actually saw
  // earns its own bump on top of the performance/statement bonuses above.
  const isUnderdogWin = result.win && result.winProb < 0.35;

  let legacyDelta = 0;
  if (result.win) {
    legacyDelta = result.method === "KO/TKO" ? 8 : result.method === "Submission" ? 7 : 5;
    legacyDelta += Math.max(0, Math.round((opp.overall - 70) / 5));
    if (isTitleShot) legacyDelta += choiceTag === "shortNoticeTitle" ? 24 : choiceTag === "demandShot" ? 21 : 18;
    if (isTitleDefense) legacyDelta += 12;
    if (isStatement) legacyDelta += 5;
    if (isRivalry) legacyDelta += 4;
    // Winning while fighting against your own natural grain is harder to set
    // up but more memorable when it lands -- a "proved them wrong" bonus.
    if (s.careerStyle && s.careerStyle !== "Balanced" && !s.styleIsNaturalFit) legacyDelta += 3;
    if (bonusType) legacyDelta += 6;
    if (isUnderdogWin) legacyDelta += 4;
    // Calling your shot and landing it is worth more than the same win
    // falling out of ordinary matchmaking.
    if (isCallout) legacyDelta += 7;
  } else {
    legacyDelta = result.method === "KO/TKO Loss" ? -6 : result.method === "Submission Loss" ? -5 : -3;
    if (isTitleDefense) legacyDelta -= 4;
    if (isTitleShot) legacyDelta -= choiceTag === "shortNoticeTitle" ? 6 : choiceTag === "demandShot" ? 3 : 2;
    // A Fight of the Night loss is still a loss, but a hard-fought war
    // shouldn't sting exactly as much as a listless decision loss does.
    if (bonusType === "fotn") legacyDelta += 3;
    // Called your shot and got beat -- that's a bigger story than a loss
    // nobody saw coming you into.
    if (isCallout) legacyDelta -= 5;

    const severity = (isTitleDefense ? 100 : 0) + opp.overall;
    if (!s.definingLoss || severity > s.definingLoss.severity) {
      s.definingLoss = {
        severity, oppName, oppRating: opp.overall, wasTitle: isTitleDefense,
        fightSnapshot: { effective, reachScore: s.reachScore, oppAttrs: opp.attrs, stanceBias, playerTraits, oppTraits: opp.traits, totalRounds },
      };
    }
  }
  // Legacy weighs the level of competition, not just wins piled up -- a
  // Regional tear and a Premier reign shouldn't earn the same score per
  // fight. Weighted by the tier this fight was actually fought at
  // (tierBefore, same as the fight card's own tier badge).
  const TIER_LEGACY_MULT = { "CLF Regional": 0.55, "CLF National": 0.8, "CLF Contender Series": 1, "CLF PREMIER": 1.25 };
  legacyDelta = Math.round(legacyDelta * (TIER_LEGACY_MULT[tierBefore] ?? 1));
  s.runningLegacy = Math.max(0, s.runningLegacy + legacyDelta);

  // Purse: paid out on the contract signed at the time, scaled by the
  // tier the fight actually happened at -- a Regional purse and a Premier
  // purse shouldn't read anywhere close to the same. Contender Series
  // pays nothing (it's a tryout, not a sanctioned bout on the books yet).
  const purseGain = isContenderSeriesFight ? 0 : purseForFight(s.contract, tierBefore, result.win, stats.finishRound != null, s.fame);
  s.purse += purseGain;

  const interview = buildInterviewLine(oppName, result, {
    isTitleShot, isTitleDefense, isRivalry, isStatement, bonusType, fightWasClose,
  });

  const timeline = [...s.timeline];
  if (tierChanged) {
    const promoted = CLF_TIER_ORDER.indexOf(s.circuitTier) > CLF_TIER_ORDER.indexOf(tierBefore);
    timeline.push({ type: "circuitMove", id: `circuit-${s.fightGlobalIndex}`, promoted, from: tierBefore, to: s.circuitTier });
  }
  if (rivalryJustBorn) timeline.push({ type: "rivalEvent", id: `rival-${s.fightGlobalIndex}`, oppName });
  if (hype) timeline.push({ type: "hypeEvent", id: `hype-${s.fightGlobalIndex}`, ...hype });
  // Event branding: numbered CLF cards, with a real card position. Title
  // fights headline; rivalries and elite opponents get the co-main slot.
  const eventNumber = 100 + s.fightGlobalIndex * 3 + (s.year % 3);
  const cardPosition = isTitleFight || isContenderSeriesFight
    ? "MAIN EVENT"
    : (isRivalry || isStatement) ? "CO-MAIN EVENT"
    : opp.overall >= 78 ? "MAIN CARD" : "PRELIMS";
  timeline.push({
    type: "fight", id: `f-${s.fightGlobalIndex}`, index: s.fightGlobalIndex,
    opp: oppName, oppRating: opp.overall, oppRecord, oppRank, archetype: opp.archetype,
    // Player's own overall/record entering this fight, snapshotted the same
    // way oppRecord is -- mirrors the opponent corner so the fight card can
    // show name -> rank/archetype -> OVR+record consistently on both sides.
    playerOverall: playerOverallNow, playerRecord: state.record,
    // The tier this fight was actually contested at -- a title-fight win
    // that triggers a promotion still happened AT the old tier; the move
    // itself shows up as its own circuitMove timeline entry right after.
    circuitTier: tierBefore, eventNumber, cardPosition,
    onStyle: s.careerStyle && s.careerStyle !== "Balanced" ? s.styleIsNaturalFit : null,
    win: result.win, method: result.method,
    titleShot: isTitleShot, titleDefense: isTitleDefense, shortNotice: choiceTag === "shortNoticeTitle", demanded: choiceTag === "demandShot",
    contenderSeries: isContenderSeriesFight, calledOut: isCallout,
    rivalry: isRivalry, statement: isStatement, bonusType, interview, underdogWin: isUnderdogWin,
    // Raw playerRank/champion flags, not labels -- rankLabel() renders
    // these at display time, same convention as yearEnd's
    // rankBefore/rankAfter. playerRank is the real ladder position (the
    // single source of truth for anything shown as "my ranking"); the
    // internal rankPoints snapshots are kept too, unrendered, purely for
    // anything that still legitimately wants the hidden momentum value.
    rankBefore: playerRankBefore, championBefore, rankAfter: playerRankAfterFight, championAfter: championAfterFight,
    rankPointsBefore, rankPointsAfter: rankPointsAfterFight,
    matchup: result.matchup, narrative: result.narrative, playerTraits,
    roundNarratives: result.roundNarratives, moments: result.moments, howItHappened: result.howItHappened,
    stats, rounds, purseGain,
  });
  s.timeline = timeline;

  s.fightsRemainingThisYear -= 1;
  if (s.weightPenaltyFightsLeft > 0) s.weightPenaltyFightsLeft -= 1;
  s.mediaBuff = null;
  // A fresh Premier contract waits until the very next decision point --
  // everything about THIS fight (result card, rank move, the promotion
  // banner) still needs to render first.
  s.pendingDecision = triggerContractNegotiation ? { type: "contractNegotiation" } : null;
  s.pendingFight = null;
  return s;
}

// Convenience wrapper for callers that want a fight fully resolved in one
// step with no interactive pre-fight screen in between (fast-forward, and
// title fights that skip straight past the matchmaker-choice decision).
function runFight(state, choiceTag) {
  return commitFight(prepareFight(state, choiceTag));
}

// A short reflective beat before the final numbers, tuned to how the career actually went.
function retirementLine(record, verdict) {
  if (verdict === "Generational Talent" || verdict === "First-Ballot Hall of Famer") {
    return "The crowd rises to its feet one last time. A career for the ages comes to a close.";
  }
  if (record.l === 0 && record.w > 0) {
    return "Undefeated, undisputed, and walking away on his own terms.";
  }
  if (verdict === "Hall of Fame") {
    return "A hall-of-fame run ends the way it should — on top, and on his own terms.";
  }
  if (verdict === "Fringe Hall of Famer" || verdict === "Legitimate Contender") {
    return "Not a legend, but a fighter who left everything in the cage.";
  }
  return "The final bell rings on a career that mattered, win or lose.";
}

// Scans back to the most recent "year" divider and summarizes that year's
// fights -- record, rank movement, and the standout win/loss.
function summarizeYear(timeline, yearStartRank, yearStartChampion, rankNow, championNow, yearStartTier, tierNow) {
  let idx = timeline.length - 1;
  while (idx >= 0 && timeline[idx].type !== "year") idx -= 1;
  const yearFights = timeline.slice(idx + 1).filter((e) => e.type === "fight");
  const wins = yearFights.filter((f) => f.win);
  const losses = yearFights.filter((f) => !f.win);
  const bestWin = wins.length ? wins.reduce((a, b) => (b.oppRating > a.oppRating ? b : a)) : null;
  const toughestLoss = losses.length ? losses.reduce((a, b) => (b.oppRating > a.oppRating ? b : a)) : null;
  return {
    wins: wins.length, losses: losses.length, bestWin, toughestLoss,
    rankBefore: yearStartRank, championBefore: yearStartChampion,
    rankAfter: rankNow, championAfter: championNow,
    // A tier change (Regional -> National, etc.) is a bigger story than a
    // ranking-label move within the same division -- surfaced separately so
    // the recap card can call it out instead of burying it in "Ranking".
    tierBefore: yearStartTier, tierAfter: tierNow,
  };
}

// Career-long best wins for the broadcast-style stat line -- the top 3 by
// opponent rating, not just a count. Ties resolve by fight order, which is
// stable-sort behavior for .sort on arrays already in timeline order.
function topCareerWins(timeline) {
  return timeline
    .filter((e) => e.type === "fight" && e.win)
    .sort((a, b) => b.oppRating - a.oppRating)
    .slice(0, 3)
    .map((e) => ({ opp: e.opp, oppRating: e.oppRating, method: e.method, titleShot: e.titleShot, titleDefense: e.titleDefense }));
}

function finishCareerState(state) {
  const { legacyScore, bonus, finishRate, strengthOfSchedule } = calculateLegacy(state);
  const totalFightCount = state.timeline.filter((e) => e.type === "fight").length;
  const verdict = verdictFor(legacyScore, state.peakCircuitTier);
  // The last year in progress never goes through advanceCareer's yearEnd
  // branch (finishCareerState fires in its place), so its legacy gain has
  // to be folded into peakYearLegacy here too, the same way, or a career
  // that peaks in its final year would never register that peak.
  const finalYearGain = Math.max(0, state.runningLegacy - state.yearStartLegacy);
  const finalYearIsPeak = finalYearGain > (state.peakYearLegacy || 0);
  const peakYearLegacy = finalYearIsPeak ? finalYearGain : (state.peakYearLegacy || 0);
  const peakYearNumber = finalYearIsPeak ? state.year : (state.peakYearNumber || 1);
  const timeline = [...state.timeline,
    { type: "retirement", id: "retirement", line: retirementLine(state.record, verdict) },
    {
      type: "summary", id: "summary",
      finishRate: Math.round(finishRate * 100), strengthOfSchedule: Math.round(strengthOfSchedule),
      peakRankPoints: state.peakRankPoints, peakPlayerRank: state.peakPlayerRank, rankedFightCount: state.rankedFightCount,
      statementWins: state.statementWins, rivalryWins: state.rivalryWins, bonus,
      peakYearLegacy, peakYearNumber, yearsActive: state.year, topWins: topCareerWins(state.timeline),
    },
  ];
  return { ...state, timeline, finished: true, legacyScore, verdict, totalFightCount, peakYearLegacy, peakYearNumber };
}

function advanceCareer(state) {
  if (state.finished || state.pendingDecision) return state;
  if (state.fightsRemainingThisYear > 0) return maybeFightChoice(state);
  if (state.year >= state.totalYears) return finishCareerState(state);
  const yearSummary = summarizeYear(state.timeline, state.yearStartRank, state.yearStartChampion, state.playerRank, state.champion, state.yearStartTier, state.circuitTier);
  // How much Legacy Score this year alone was worth -- kept as a running
  // peak so "Legacy Score" (the whole career, uneven years and all) and
  // "Best Year" (your single best stretch) can be shown side by side at
  // retirement instead of one number hiding the other.
  const yearLegacyGain = Math.max(0, state.runningLegacy - state.yearStartLegacy);
  // "Best Year" is a QUANTITY (legacy points earned that year), not a year
  // number -- shown on the verdict screen it used to read like "Year 27" in
  // an 8-year career. Track which year actually earned it alongside the
  // number, so the display can say "Year 4" and mean it.
  const newPeak = yearLegacyGain > (state.peakYearLegacy || 0);
  const s = {
    ...state, year: state.year + 1,
    peakYearLegacy: newPeak ? yearLegacyGain : (state.peakYearLegacy || 0),
    peakYearNumber: newPeak ? state.year : (state.peakYearNumber || 1),
  };
  s.timeline = [
    ...s.timeline,
    { type: "yearEnd", id: `yearend-${state.year}`, year: state.year, legacyGain: yearLegacyGain, ...yearSummary },
    { type: "year", id: `y-${s.year}`, year: s.year },
  ];
  s.pendingDecision = { type: "campPlanning" };
  return s;
}

// Auto-resolves the rest of the career with sensible defaults (no focus,
// full camp, balanced stance, default matchmaking, address training gaps,
// stay professional in media events) for players who just want the result.
function fastForwardCareer(state) {
  let s = state;
  let guard = 0;
  while (!s.finished && guard < 600) {
    if (s.pendingDecision) {
      if (s.pendingDecision.type === "campPlanning") {
        s = resolveCampPlanning(s, { focusAttr: null, campQuality: "full", stance: "balanced" });
      } else if (s.pendingDecision.type === "fightChoice") {
        s = runFight(s, "default");
      } else if (s.pendingDecision.type === "preFight") {
        // Fast-forward skips the interactive pre-fight screen entirely --
        // commit whatever prepareFight already set up.
        s = commitFight(s);
      } else if (s.pendingDecision.type === "trainingEvent") {
        s = resolveTrainingEvent(s, s.pendingDecision.attr, true);
      } else if (s.pendingDecision.type === "mediaEvent") {
        s = resolveMediaEvent(s, false);
      } else if (s.pendingDecision.type === "offCycleEvent") {
        s = resolveOffCycleEvent(s, "charityWork");
      } else if (s.pendingDecision.type === "weightMoveOffer") {
        // Decline by default -- a fast-forwarded career has no player
        // actually weighing the trade-off, and the safe default is the one
        // that doesn't wipe rank/rankPoints progress out from under them.
        s = resolveWeightMoveOffer(s, false);
      } else if (s.pendingDecision.type === "contractNegotiation") {
        // Show Money is the safe, no-regrets default for a fast-forwarded
        // career with no player actually weighing the trade-off.
        s = resolveContractNegotiation(s, "showMoney");
      }
    } else {
      s = advanceCareer(s);
    }
    guard++;
  }
  return s;
}

// Plays the appropriate sound(s) for whatever new timeline entries appeared
// between two career states.
function playSfxForTransition(prev, next) {
  const added = next.timeline.slice(prev.timeline.length);
  added.forEach((e) => {
    if (e.type === "fight") {
      sfx(e.win ? "win" : "loss");
      if (e.titleShot || e.titleDefense) sfx("bell");
    } else if (e.type === "year") {
      sfx("whoosh");
    }
  });
}

// =========================================================================
//  ACHIEVEMENTS
// =========================================================================
// Aggregates everything already stored locally into a lightweight profile.
// No account/auth needed -- it's just a read-through of existing data.
function computePlayerProfile({ dailyStats, savedBuilds, careerHistory }) {
  const bestGoat = savedBuilds.reduce((m, b) => Math.max(m, b.goatScore || 0), 0);
  const championships = careerHistory.reduce((s, c) => s + (c.titleReigns || 0), 0);
  const hofCareers = careerHistory.filter((c) => /Hall of Fame|Generational/.test(c.verdict)).length;
  let bestRecord = null;
  careerHistory.forEach((c) => {
    if (!c.record) return;
    const diff = c.record.w - c.record.l;
    if (!bestRecord || diff > bestRecord.diff) bestRecord = { w: c.record.w, l: c.record.l, diff };
  });
  const nameCounts = {};
  savedBuilds.forEach((b) => (b.picks || []).forEach((p) => { nameCounts[p.fighter] = (nameCounts[p.fighter] || 0) + 1; }));
  let favoriteFighter = null;
  Object.entries(nameCounts).forEach(([n, c]) => { if (!favoriteFighter || c > favoriteFighter.count) favoriteFighter = { name: n, count: c }; });
  const careersCompleted = careerHistory.length;
  return {
    totalBuilds: savedBuilds.length,
    bestGoat,
    dailyStreak: dailyStats.currentStreak,
    bestDailyStreak: dailyStats.bestStreak || dailyStats.currentStreak || 0,
    careersCompleted,
    championships,
    hofCareers,
    bestRecord,
    favoriteFighter,
    metaRank: metaRankFor(bestGoat, championships, careersCompleted),
  };
}

// Light meta-progression -- purely a local, cosmetic read of existing stats.
// No separate XP counter to persist; it just re-derives from the profile
// every time, so it can never drift out of sync with the data it reflects.
function metaRankFor(bestGoat, championships, careersCompleted) {
  if (bestGoat >= 95 || championships >= 3) return "Legend";
  if (bestGoat >= 85 || championships >= 1) return "Champion";
  if (bestGoat >= 70 || careersCompleted >= 1) return "Contender";
  return "Rookie";
}

function rankToTierCls(rank) {
  if (rank === "Legend") return "tier-legend";
  if (rank === "Champion") return "tier-gold";
  if (rank === "Contender") return "tier-silver";
  return "tier-bronze";
}

function computeAchievements({ dailyStats, savedBuilds, careerHistory }) {
  return [
    { id: "first90", label: "First 90+ GOAT", desc: "Save a build with a GOAT Score of 90 or higher.", achieved: savedBuilds.some((b) => b.goatScore >= 90) },
    { id: "perfect", label: "Perfect Build", desc: "Reach a 100 GOAT Score.", achieved: savedBuilds.some((b) => b.goatScore >= 100) },
    { id: "complete", label: "Complete Fighter", desc: "Save a build with no attribute rating below 70.", achieved: savedBuilds.some((b) => (b.picks || []).every((p) => (p.scoreValue || 0) >= 70)) },
    { id: "champ", label: "Champion Builder", desc: "Win a title in Career Mode.", achieved: careerHistory.some((c) => c.titleReigns > 0) },
    { id: "dualchamp", label: "Double Champ", desc: "Win two or more title reigns in one career.", achieved: careerHistory.some((c) => c.titleReigns >= 2) },
    { id: "dynasty", label: "Dynasty", desc: "Defend the title three or more times in one career.", achieved: careerHistory.some((c) => (c.titleDefenses || 0) >= 3) },
    { id: "underdog", label: "Underdog", desc: "Win a title after taking two or more losses first.", achieved: careerHistory.some((c) => c.wonTitleAsUnderdog) },
    { id: "undefeated", label: "Undefeated", desc: "Retire a career with zero losses.", achieved: careerHistory.some((c) => c.record && c.record.l === 0 && c.record.w > 0) },
    { id: "rivalry", label: "Rivalry", desc: "Beat the same rival three or more times in one career.", achieved: careerHistory.some((c) => (c.rivalryWins || 0) >= 3) },
    { id: "ironman", label: "Iron Man", desc: "Complete a career of 25 or more fights.", achieved: careerHistory.some((c) => (c.totalFightCount || 0) >= 25) },
    { id: "streak7", label: "Iron Streak", desc: "Reach a 7-day Daily Challenge streak.", achieved: dailyStats.currentStreak >= 7 },
    { id: "grinder", label: "Daily Grinder", desc: "Reach a 14-day Daily Challenge streak.", achieved: (dailyStats.bestStreak || dailyStats.currentStreak || 0) >= 14 },
    { id: "streak30", label: "Unbreakable", desc: "Reach a 30-day Daily Challenge streak.", achieved: (dailyStats.bestStreak || dailyStats.currentStreak || 0) >= 30 },
    { id: "hof", label: "Hall of Famer", desc: "Retire with a Hall of Fame (or better) verdict.", achieved: careerHistory.some((c) => /Hall of Fame|Generational/.test(c.verdict)) },
  ];
}

// ---------- Result-screen presentation helpers ----------
// One-line identity taglines per build archetype (see archetypeFor()). Keyed
// off the same archetype system already computed from real stats -- nothing
// here is per-fighter hard-coded flavor.
const ARCHETYPE_TAGLINES = {
  "Knockout Artist": "Built to end fights early with fight-ending power.",
  "Ground Specialist": "Lives on the mat and finishes fights there.",
  "Tactician": "Wins the chess match more than the brawl.",
  "Iron Will": "Nearly impossible to hurt, harder to fatigue.",
  "Sharpshooter": "Picks opponents apart at range before they can close the distance.",
  "Grinder": "Wears fighters down round after round.",
  "All-Rounder": "No obvious hole to exploit — competent everywhere.",
};

// ---------- Fighting-style choice: the archetype system's actual decision point ----------
const STYLE_DESCRIPTIONS = {
  Striker: "Live and die on your feet. Boosts Striking and Power when it's your natural fit.",
  Wrestler: "Dictate where the fight happens. Boosts Wrestling and Grappling when it's your natural fit.",
  "Submission Specialist": "Hunt the finish on the mat. Boosts Grappling and Cardio when it's your natural fit.",
  "Granite Grinder": "Wear opponents down. Boosts Chin and Cardio when it's your natural fit.",
  Speedster: "Out-work everyone. Boosts Speed and Striking when it's your natural fit.",
  Balanced: "No lean either way. No bonus, no penalty -- a clean slate.",
};

export {
  ARCHETYPES,
  ARCHETYPE_TAGLINES,
  CLF_TIERS,
  CONTRACT_TYPES,
  DIVISION_SIZE,
  STYLE_DESCRIPTIONS,
  TRAIT_DEFS,
  advanceCareer,
  applyAging,
  bestFitArchetypeFlat,
  buildDivision,
  calculateLegacy,
  clfTier,
  commitFight,
  computeAchievements,
  computePlayerProfile,
  computeFightPreview,
  computeWinProbability,
  deriveTraits,
  estimatePhaseControl,
  fastForwardCareer,
  generateMatchmakerOptions,
  generateOpponentProfile,
  initCareer,
  maybeFightChoice,
  metaRankFor,
  phaseWeightedOutput,
  playSfxForTransition,
  prepareFight,
  rankLabel,
  rankToTierCls,
  resolveCampPlanning,
  resolveContractNegotiation,
  resolveFight,
  resolveMediaEvent,
  resolveOffCycleEvent,
  resolveTrainingEvent,
  resolveWeightMoveOffer,
  runFight,
  verdictFor,
  VERDICT_ORDER,
};
