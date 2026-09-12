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

// The real playerRank climb formula (unchanged math, extracted so it has
// one name and one place to live). Used both where playerRank is actually
// mutated (division-update block in commitFight) and, read-only, to
// preview what this fight's own win is about to do to playerRank before
// that block runs -- see nationalTitleEligibleNow in commitFight, which
// needs that answer earlier than the real assignment happens.
function previewRankClimb(playerRank, oppRank, win, method) {
  if (win && oppRank > 0) {
    const startRank = playerRank != null ? playerRank : DIVISION_SIZE + 1;
    if (oppRank < startRank) {
      const gap = startRank - oppRank;
      const mismatchBonus = gap >= 13 ? 5 : gap >= 9 ? 3 : gap >= 6 ? 1 : 0;
      const isFinish = method === "KO/TKO" || method === "Submission";
      const climb = 5 + mismatchBonus + (isFinish ? 1 : 0);
      return Math.max(oppRank, startRank - climb);
    }
    return playerRank;
  }
  if (!win && playerRank != null) {
    // Realism pass, item 8: losing UP should not cost the same as losing
    // DOWN. 0 is the champion's own reserved value, not a real ladder
    // position -- a title loss already has its own belt-transfer handling
    // a few lines later in commitFight, so this stays the exact
    // pre-existing flat +1 for that one case rather than reinterpreting 0
    // as "gap from the challenger."
    if (playerRank === 0) return 1;
    // A real upset (no ranked opponent at all, e.g. a callout gone wrong
    // against an unranked name) costs the most -- there's no "they were
    // just better" excuse available.
    if (oppRank == null) return Math.min(DIVISION_SIZE, playerRank + 3);
    const gapAbove = playerRank - oppRank; // positive: opponent ranked BETTER (lower number) by this many spots
    if (gapAbove >= 6) return playerRank; // a competitive loss to someone significantly above you -- standing holds
    if (gapAbove >= 1) return Math.min(DIVISION_SIZE, playerRank + 1); // lost to someone modestly better -- normal cost
    return Math.min(DIVISION_SIZE, playerRank + 2); // lost to a peer or someone ranked below you -- a real upset
  }
  return playerRank;
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

// Ranked Identity Presentation: the exact numeric badge shown directly next
// to the player's own name (Career hub, pre-fight, FightResultCard) --
// deliberately separate from rankLabel's bucketed text above, which stays
// exactly as it was everywhere it's already used (Peak Ranking, rank-move
// row, etc). Reads only the real playerRank ladder position, never the
// hidden rankPoints value, and returns null (no badge) while unranked.
// Also returns null during Contender Series even when playerRank still
// holds a real carried-over National number (see the National -> CS
// branch in commitFight) -- CS deliberately has no active ladder, same
// truth the Rankings tab and the compact Division Rankings panel already
// enforce with their own "No active ladder" note, so a bare numeric badge
// here would be exactly the stale-looking "Contender Series fighter at
// #1" confusion already fixed once elsewhere. Champion is intentionally
// NOT handled here -- champion status is a distinct textual treatment
// ("CHAMPION", never a number) each caller renders itself alongside this,
// so this function only ever returns "#N" or null.
function rankBadge(playerRank, circuitTier) {
  if (circuitTier === "CLF Contender Series") return null;
  if (playerRank == null) return null;
  return `#${playerRank}`;
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

// Tier-aware title prestige -- deliberately three keys, not four. Contender
// Series never has a belt: isTitleShot/isTitleDefense are both explicitly
// gated `!isContenderSeriesFight` below, and s.champion is forced false the
// moment a fighter enters Contender Series (see leftBeltBehindForContender
// Series in commitFight) -- no title fight can ever happen at that tier.
const TITLE_TIERS = ["CLF Regional", "CLF National", "CLF PREMIER"];
function freshTitleTierCounts() {
  return TITLE_TIERS.reduce((acc, t) => { acc[t] = 0; return acc; }, {});
}

// National title-path audit (Option D, calibrated): the natural title-shot
// rank bar was originally loosened to <=6 for National only, since
// playerRank<=5 almost never arrived before the National->Contender-Series
// performance gate did. Realism-v1 follow-up found <=6 still wasn't enough
// -- the gate itself (nationalGatePass, a couple hundred lines down) only
// needs 2 quality wins, which a real ranked climb (needing several wins to
// actually reach a single-digit rank from a fresh National entry) still
// couldn't reliably beat. Raising the gate's own win requirement instead
// was tried and rejected (it cost ELITE/GOAT-tier Premier reach); <=8 was
// also tried and overshot (National title-route promotions jumped from
// ~2% to ~16% of the total, no longer "rare but real"). <=7 is the
// settled value: title-route promotions land around ~7% (vs the 2%
// baseline) while the gate stays the clear majority route, same shape as
// the original Option D calibration this comment describes, just moved
// one further given the follow-up's larger sample. Regional has its own
// threshold (see REGIONAL_TITLE_RANK_THRESHOLD below); Premier is
// untouched, still <=5.
const NATIONAL_TITLE_RANK_THRESHOLD = 7;
// Matchmaking Realism V1: the audit found the Regional title route even
// more starved than National's pre-Option-D state was (0 wins in 65,036
// Regional fights) -- the flat streak>=4 fast-track (see
// regionalFastTrackReady in commitFight) almost always fired before a
// Regional climb, mostly against the 24 unranked prospects who fill early
// matchmaking, could ever reach rank<=5. Loosened the same way National's
// was (Option D above), plus the fast-track itself now requires the streak
// to include a real ranked win (see regionalEverBeatRanked in
// commitFight) so the two changes work together rather than one alone
// trying to fix it.
const REGIONAL_TITLE_RANK_THRESHOLD = 7;
const DEFAULT_TITLE_RANK_THRESHOLD = 5;
function naturalTitleRankThreshold(circuitTier) {
  if (circuitTier === "CLF National") return NATIONAL_TITLE_RANK_THRESHOLD;
  if (circuitTier === "CLF Regional") return REGIONAL_TITLE_RANK_THRESHOLD;
  return DEFAULT_TITLE_RANK_THRESHOLD;
}

// Premier progression curve pass, Part B: at Premier only, the natural
// title shot used to fire the instant playerRank<=5 && streak>=2 -- audit
// measured entry->Top5, entry->title shot, and entry->champion all
// landing within ~0.6 fights of each other for elite runs, collapsing
// "I'm a real contender" and "I earned the shot" into the same moment.
// Adds one real beat in between: a Top 5 fighter has to win ONE MORE
// fight while still ranked Top 5 (real existing fight/rank truth, no new
// points/tokens/timers) before the natural path activates. Prototyped
// against two smaller alternatives first -- streak>=3 instead of >=2
// barely moved the gap (median stayed 0: a fighter already mid-streak
// when they crest Top 5 just keeps the shot on the same fight), and
// rank<=3 instead of <=5 was unreliable (median 0 despite a positive
// average -- a single big climb can jump rank<=5 straight to <=3 in one
// fight, same collapse, just at a different threshold). This is the one
// that actually produces a consistent ~1-fight gap. Demand/Short-Notice
// don't call this at all, by design -- untouched, and Regional/National
// keep their exact existing natural formulas (the PREMIER-only branch is
// the only new behavior).
function naturalTitleShotReady(circuitTier, champion, streak, playerRank, provenAtTop5) {
  if (champion || playerRank == null || streak < 2) return false;
  if (playerRank > naturalTitleRankThreshold(circuitTier)) return false;
  if (circuitTier === "CLF PREMIER") return !!provenAtTop5;
  return true;
}

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

// ---- Recent-form helpers ---------------------------------------------------
// Small, derived-only readers over a fighter's existing recentForm/record --
// no new persistent state, nothing that needs saving or migrating. Used by
// matchmaking (Ranked/Step-Up eligibility) and Mic Time target selection.
function currentWinStreak(fighter) {
  const form = fighter.recentForm || [];
  let n = 0;
  for (const r of form) { if (r === "W") n += 1; else break; }
  return n;
}
function recentWins(fighter) {
  return (fighter.recentForm || []).filter((r) => r === "W").length;
}
function recentLosses(fighter) {
  const form = fighter.recentForm || [];
  return form.length - recentWins(fighter);
}
function isOnLosingSkid(fighter, n = 2) {
  const form = fighter.recentForm || [];
  let streak = 0;
  for (const r of form) { if (r === "L") streak += 1; else break; }
  return streak >= n;
}
// A real winning record, a real recent stretch, and not currently losing --
// the baseline "this fighter is a live opportunity, not a name for the sake
// of one" bar that both Step-Up eligibility and Mic Time's "hot nearby
// contender" candidate lean on.
function isHotContender(fighter) {
  return fighter.record.w > fighter.record.l && recentWins(fighter) >= 3 && !isOnLosingSkid(fighter, 2);
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

// Tier-aware title prestige for the retirement Legacy bonus -- Premier is
// the world-title analogue and dominates; Regional is real but a stepping
// stone. This is a SEPARATE prestige expression from the per-fight
// TIER_LEGACY_MULT weighting further down (runningLegacy accrual, live
// during the career) -- that one stays untouched. This one replaces the
// old flat `titleReigns*20 + titleDefenses*10` term below, it does not
// stack on top of it.
const TITLE_REIGN_VALUE = { "CLF Regional": 8, "CLF National": 14, "CLF PREMIER": 26 };
const TITLE_DEFENSE_VALUE = { "CLF Regional": 3, "CLF National": 6, "CLF PREMIER": 12 };
function titleTierBonus(reignsByTier, defensesByTier) {
  return TITLE_TIERS.reduce((sum, tier) => (
    sum + ((reignsByTier && reignsByTier[tier]) || 0) * TITLE_REIGN_VALUE[tier]
        + ((defensesByTier && defensesByTier[tier]) || 0) * TITLE_DEFENSE_VALUE[tier]
  ), 0);
}

// Retuned alongside the GOAT Score changes: legacy bonuses trimmed slightly
// and verdict thresholds raised so Hall of Fame-tier careers feel earned.
function calculateLegacy(state) {
  const {
    record, finishes, titleReignsByTier, titleDefensesByTier, peakRankPoints,
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
  bonus += titleTierBonus(titleReignsByTier, titleDefensesByTier);

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

// Roster Ecology V1: the champion/ranked ladder above is untouched and
// stays identical at every circuit tier (prestige shouldn't erode just
// because the world underneath gets deeper). The UNRANKED tier is what
// this pass replaces -- previously a single monotonic-taper population
// (UNRANKED_COUNT=24 everywhere), which the Division Depth + Roster
// Ecology Audit found structurally incapable of producing a winning-record
// unranked fighter at all (0/19,200 sampled satisfied isHotContender) and
// identical regardless of which circuit you were actually in. Tier-specific
// counts below (tested head-to-head against a flat-40-everywhere baseline
// and a deeper-Premier alternative -- see this branch's own report):
// Regional stays exactly as before (a proving ground doesn't need to be
// bigger, just believable); National and Premier grow, Premier the most --
// a major promotion's roster should feel deeper than a regional one, and
// the audit's own finding that "just add more fighters" doesn't help
// elite pacing on its own was about population QUALITY, not tier-aware
// sizing paired with ecology-aware selection (see ecologyPoolFor below).
const TIER_UNRANKED_COUNT = {
  "CLF Regional": 24,
  "CLF National": 32,
  "CLF PREMIER": 40,
};
function unrankedCountFor(circuitTier) {
  return TIER_UNRANKED_COUNT[circuitTier] || TIER_UNRANKED_COUNT["CLF Regional"];
}

// ---- Unranked ecology buckets ------------------------------------------
// Each bucket is {baseRating:[lo,hi], experience:[lo,hi], winRate:[lo,hi]}.
// baseRating deliberately OVERLAPS the bottom of the ranked ladder (#11-15
// run roughly baseRating 55-70 -- see buildDivision's ranked baseRating
// formula) for RANKING_BUBBLE, and can exceed it for HOT_PROSPECT -- rank
// is meant to be résumé+standing, not a perfectly sorted OVR list (brief
// section 3/11), so "unranked" must be able to mean "hasn't proven it yet,"
// not "worse." winRate/experience are read directly by generateBucketRecord
// (a small, parameterized alternative to generateOpponentRecord/winRateFor
// -- those two stay completely unchanged, still driving champion/ranked/
// Contender-Series generation exactly as before; this is a genuinely
// different generation rule the audit found no existing function could
// produce, not a duplicate of one).
const ECOLOGY_BUCKETS = {
  // "Let's see if this prospect belongs" -- a real shot at #15 already.
  RANKING_BUBBLE: { baseRating: [56, 70], experience: [9, 22], winRate: [0.66, 0.85] },
  // Fewer fights, excellent record -- résumé hasn't caught up to talent.
  HOT_PROSPECT: { baseRating: [58, 76], experience: [4, 10], winRate: [0.72, 1.0] },
  // Significant experience, mixed record, still dangerous -- "you have to
  // beat this guy to prove you belong."
  VETERAN_GATEKEEPER: { baseRating: [54, 68], experience: [20, 34], winRate: [0.55, 0.7] },
  // Competent pro, neither elite nor developmental.
  SOLID_UNRANKED: { baseRating: [48, 60], experience: [8, 18], winRate: [0.42, 0.58] },
  // Appropriate early-career opposition.
  DEVELOPMENTAL: { baseRating: [40, 52], experience: [3, 9], winRate: [0.25, 0.45] },
};
// Proportions of the UNRANKED slice per persistent circuit tier. All five
// buckets exist at every tier -- only the MIX shifts, so no tier is pure
// filler and no tier is pure elite prospects. Regional (a proving ground)
// leans developmental/solid; National (a serious pro circuit) shifts
// toward veterans and the ranking bubble; Premier (a major promotion)
// carries the deepest bubble/prospect population and the fewest true
// developmental opponents.
const UNRANKED_ECOLOGY_MIX = {
  "CLF Regional": [
    ["DEVELOPMENTAL", 0.30], ["SOLID_UNRANKED", 0.28], ["VETERAN_GATEKEEPER", 0.20],
    ["HOT_PROSPECT", 0.12], ["RANKING_BUBBLE", 0.10],
  ],
  "CLF National": [
    ["DEVELOPMENTAL", 0.14], ["SOLID_UNRANKED", 0.24], ["VETERAN_GATEKEEPER", 0.26],
    ["HOT_PROSPECT", 0.16], ["RANKING_BUBBLE", 0.20],
  ],
  "CLF PREMIER": [
    ["DEVELOPMENTAL", 0.08], ["SOLID_UNRANKED", 0.22], ["VETERAN_GATEKEEPER", 0.24],
    ["HOT_PROSPECT", 0.18], ["RANKING_BUBBLE", 0.28],
  ],
};
function pickInRange([lo, hi]) { return lo + Math.random() * (hi - lo); }
// Parameterized directly off a bucket's own experience/winRate ranges,
// rather than derived from overall rating the way generateOpponentRecord's
// winRateFor works -- that coupling is exactly why the old generator could
// never produce a low-fight-count, high-win% "hot prospect" no matter how
// high its baseRating rolled (winRateFor tops out at 0.75 for any
// non-ranked/champion tier). See this file's own audit history.
function generateBucketRecord(experienceRange, winRateRange) {
  const experience = Math.round(pickInRange(experienceRange));
  const winRate = pickInRange(winRateRange);
  const wins = Math.round(experience * winRate);
  const losses = Math.max(0, experience - wins);
  return { w: wins, l: losses };
}
function createEcologyFighter(name, seedIndex, ecology) {
  const def = ECOLOGY_BUCKETS[ecology];
  const baseRating = Math.round(pickInRange(def.baseRating));
  const profile = generateOpponentProfile(baseRating);
  const record = generateBucketRecord(def.experience, def.winRate);
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
    // Generation-origin metadata ONLY -- not a permanent role lock. Drives
    // initial candidate-pool selection (ecologyPoolFor/pickEcologyCandidate
    // below); nothing gates ELIGIBILITY on it that the fighter's own
    // current record/form/rank can't already answer (isHotContender,
    // isOnLosingSkid, displayRankFor all still read real current numbers,
    // same as every other fighter). A fighter generated as a
    // VETERAN_GATEKEEPER who goes on a tear still reads as isHotContender
    // to Step-Up; this tag never overrides that. Kept because it's a cheap,
    // useful generation/debugging seam (this branch's report reads
    // populations off it directly) -- not because runtime logic strictly
    // requires a stored label instead of re-deriving one.
    ecology,
  };
}
// Flat list of bucket names for `count` unranked slots, proportioned per
// `circuitTier`'s mix, then SHUFFLED -- a blocked layout (all bubble
// fighters first, then all prospects, ...) would make selectDivisionOpponent's
// centre+-jitter draw an accident of BUCKET ORDER rather than a fair
// reflection of bucket CONTENT (confirmed during the read-only audit this
// branch is based on). Ecology-aware selection (ecologyPoolFor/
// pickEcologyCandidate) doesn't depend on this shuffle for correctness --
// it filters by characteristic, not position -- but the plain centre+jitter
// fallback path still exists (see selectDivisionOpponent) and must not
// silently start reading array position as quality again.
function buildUnrankedEcology(count, circuitTier) {
  const mix = UNRANKED_ECOLOGY_MIX[circuitTier] || UNRANKED_ECOLOGY_MIX["CLF Regional"];
  const flat = [];
  mix.forEach(([ecology, proportion]) => {
    const n = Math.round(count * proportion);
    for (let j = 0; j < n && flat.length < count; j++) flat.push(ecology);
  });
  while (flat.length < count) flat.push("SOLID_UNRANKED"); // rounding remainder
  for (let i = flat.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [flat[i], flat[j]] = [flat[j], flat[i]];
  }
  return flat;
}

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
// circuitTier picks the unranked population's size and ecology mix (see
// TIER_UNRANKED_COUNT/UNRANKED_ECOLOGY_MIX above); defaults to Regional so
// any call site that genuinely can't supply a tier yet (none currently
// need to -- see this branch's own report) still gets a valid division
// rather than a crash. The champion + ranked ladder (indices 0..DIVISION_SIZE)
// is generated exactly as before, completely tier-independent -- the Top 15
// stays equally prestigious everywhere; only what's underneath it changes.
function buildDivision(circuitTier = "CLF Regional") {
  const unrankedCount = unrankedCountFor(circuitTier);
  const total = DIVISION_SIZE + 1 + unrankedCount;
  const names = generateOpponentNames(total);
  const ecologyAssignments = buildUnrankedEcology(unrankedCount, circuitTier);
  const roster = names.map((name, i) => {
    if (i <= DIVISION_SIZE) {
      // Champion is strongest; strength tapers through the rankings --
      // completely unchanged from before this pass.
      const baseRating = i === 0 ? 92 : clamp(Math.round(90 - i * 2.1 + (Math.random() * 6 - 3)), 58, 91);
      return createDivisionFighter(name, baseRating, i, i === 0 ? "champion" : "ranked");
    }
    return createEcologyFighter(name, i, ecologyAssignments[i - (DIVISION_SIZE + 1)]);
  });
  roster[0].isChampion = true;
  return roster;
}

// =========================================================================
//  PERSISTENT UNIVERSE FOUNDATION V1
//  Phase 1 of the persistent-world roadmap (see this branch's own
//  architecture audit report for the full model comparison). Before this,
//  exactly one division ever existed in state at a time -- Regional
//  disappeared the instant the player was promoted to National, National
//  disappeared the instant they reached Premier. From here on, all three
//  persistent circuits are generated at career start and coexist for the
//  life of the career; only the ACTIVE one (state.circuitTier) is what the
//  player is currently fighting in. Non-active divisions are deliberately
//  STATIC in this pass -- Phase 2 (NPC World Movement + Bout Ledger) is
//  what will actually simulate them, through a real persisted result from
//  day one, not invisible record mutation.
// =========================================================================
const UNIVERSE_SCHEMA_VERSION = 1;

// Canonical circuit-tier -> persistent-universe-division-key mapping --
// the ONE place this string translation happens, so it can never drift
// between call sites. Only the three genuinely persistent tiers resolve to
// a key; Contender Series deliberately has none -- it stays exactly what
// it already was, a temporary showcase pipeline between National and
// Premier (generateContenderSeriesOpponent, untouched), never a persistent
// division -- and any unrecognized/typo'd circuit string ALSO returns null
// rather than silently falling back to Regional. Pre-hardening this used
// to default everything unrecognized (CS included) to "regional" -- a safe
// enough choice while nothing actually branched on CS through this
// function, but not safe for a foundation other code will build on: a
// future caller that mistakenly passed CS here would have silently read
// or written the REGIONAL division instead of getting a clear signal that
// CS has no persistent division at all. Callers must handle a null key
// explicitly (see syncActiveDivision/getDivisionForTier/getActiveDivision
// below) -- never assume it's always one of the three strings.
function circuitToUniverseKey(circuitTier) {
  if (circuitTier === "CLF Regional") return "regional";
  if (circuitTier === "CLF National") return "national";
  if (circuitTier === "CLF PREMIER") return "premier";
  return null;
}

// A Contender Series stint has no persistent division of its own -- see
// circuitToUniverseKey above -- but it is also never a dead end: the only
// transition into CS anywhere in this file is National -> CS (see
// commitFight's leftBeltBehindForContenderSeries branch), and that branch
// deliberately does NOT resync state.divisionRoster, so a career currently
// mid-CS still has its actual, current National roster sitting in
// state.divisionRoster (and state.universe.divisions.national) the whole
// time -- CS fights themselves are resolved against a temporary showcase
// opponent (generateContenderSeriesOpponent), never against a roster at
// all. Anywhere this file needs "which persistent tier does the CURRENTLY
// ACTIVE roster actually belong to" (as opposed to "what division did the
// caller literally ask for", which is what circuitToUniverseKey alone
// answers), route circuitTier through this translation first. Passing CS
// straight into circuitToUniverseKey is correct and intentional everywhere
// else -- it means exactly "no persistent division" -- but here it would
// wrongly resolve to null (or, pre-hardening, silently alias to Regional).
function persistentTierForActiveRoster(circuitTier) {
  return circuitTier === "CLF Contender Series" ? "CLF National" : circuitTier;
}

// ---- Serializable universe RNG -----------------------------------------
// Background/universe-only generation must never consume the player's own
// Math.random() stream -- doing so would silently reshuffle the player's
// own subsequent matchmaking/fight outcomes purely because unrelated
// background generation happened to run first (see this branch's own
// audit, RNG risk section). mulberry32-style PRNG: `rngState` is a single
// plain 32-bit integer, safe to store/restore through JSON exactly like
// every other Career field -- never a function object. nextUniverseRandom
// is a pure function (same state always produces the same {value,
// nextState} pair), so universe generation stays fully reproducible.
function nextUniverseRandom(rngState) {
  let a = ((rngState | 0) + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, nextState: a };
}

// buildDivision and its nested generation helpers (createDivisionFighter,
// createEcologyFighter, buildUnrankedEcology, generateOpponentProfile,
// generateRecentForm, ...) all call the bare global Math.random() directly,
// several layers deep. Rewiring every one of them to accept and thread an
// explicit rng parameter would be a much larger, riskier change for a
// same-file-only concern -- so instead this swaps the ONE shared entry
// point they all already call through, for the exact duration of a single
// buildDivision() call, then restores it -- guaranteed, even if generation
// throws. Single-threaded JS has no reentrancy risk here, and this can
// never leak into any other code: nothing outside this function ever sees
// the swapped Math.random. Default player-facing generation (any call to
// plain buildDivision(tier), with no rng override) is completely untouched.
function buildDivisionWithUniverseRng(tier, rngState) {
  let state = rngState;
  const rngFn = () => {
    const { value, nextState } = nextUniverseRandom(state);
    state = nextState;
    return value;
  };
  const original = Math.random;
  Math.random = rngFn;
  try {
    return { division: buildDivision(tier), nextRngState: state };
  } finally {
    Math.random = original;
  }
}

// Reassigns every fighter's id in a freshly-built division to the
// universe-wide sequence (fighter-1, fighter-2, ...), threading the
// sequence value explicitly through the call -- never a shared mutable
// counter -- so it stays serialization-safe and fully reproducible. A
// pure post-process pass, not a rewrite of buildDivision's own id
// assignment: those nested helpers still stamp their own generation-local
// `div-<index>-<slug>` id exactly as before (harmless -- it's simply
// overwritten here), which was the smallest way to solve id allocation
// independently of random-number generation rather than threading a
// second parameter through the same several nested helpers item 10 above
// already found not worth rewiring for the RNG itself.
function assignUniverseFighterIds(division, fighterSeq) {
  let seq = fighterSeq;
  const withIds = division.map((f) => {
    seq += 1;
    return { ...f, id: `fighter-${seq}` };
  });
  return { division: withIds, nextFighterSeq: seq };
}

// Builds a brand-new 3-tier universe. `activeCircuitTier`'s own division is
// generated with the DEFAULT (unseeded, global Math.random) path --
// byte-for-byte the same call a pre-Foundation-V1 initCareer already made
// -- so a fresh career's own active-tier randomness consumption is
// completely unaffected by National/Premier now also being generated
// alongside it. The other two tiers are generated purely from the isolated
// universe RNG stream, seeded once from `seed` (never itself read from
// Math.random -- see buildFreshUniverse's own callers for why). Fighter
// ids are assigned from one continuous sequence across all three tiers
// afterward, so every NPC in the universe has a globally unique identity
// from the moment it's created.
function buildFreshUniverse(activeCircuitTier, seed, startingFighterSeq = 0) {
  // Falls back to "regional" rather than letting a null key reach the
  // `divisions[key] = ...` write below -- activeCircuitTier is always one
  // of the three persistent tiers at every real call site (initCareer
  // always passes "CLF Regional"; resolveWeightMoveOffer translates
  // through persistentTierForActiveRoster before calling this), so this
  // fallback is pure defense against a future/unexpected caller, never
  // exercised on any path exercised today.
  const activeKey = circuitToUniverseKey(activeCircuitTier) || "regional";
  // startingFighterSeq lets a caller continue the SAME global fighter-id
  // sequence into a brand-new universe instead of restarting it at 0 --
  // required for weight-class moves (see resolveWeightMoveOffer): the old
  // universe is discarded, but its ids must never be handed out again to a
  // different fighter, since a future pass (fighter histories, event
  // archives, title lineage) will want every id that was ever issued in
  // this career to stay uniquely attributable. initCareer's own call
  // (career start, nothing to continue from) relies on the default of 0.
  let fighterSeq = startingFighterSeq;
  let rngState = seed;
  const divisions = {};
  ["CLF Regional", "CLF National", "CLF PREMIER"].forEach((tier) => {
    const key = circuitToUniverseKey(tier);
    let roster;
    if (key === activeKey) {
      roster = buildDivision(tier);
    } else {
      const result = buildDivisionWithUniverseRng(tier, rngState);
      roster = result.division;
      rngState = result.nextRngState;
    }
    const idResult = assignUniverseFighterIds(roster, fighterSeq);
    divisions[key] = idResult.division;
    fighterSeq = idResult.nextFighterSeq;
  });
  // worldTickSeq/boutSeq/bouts (NPC World Movement + Bout Ledger V1): a
  // brand-new universe starts with no world history yet -- explicit here
  // (not left to the `|| 0`/`|| []` fallbacks every read site also
  // tolerates, for an old-shape/pre-ledger universe) for the same reason
  // fighterSeq is explicit above: this is the one place a universe is
  // truly starting from nothing, so it should say so plainly rather than
  // relying on undefined-reads-as-default everywhere else.
  //
  // eventSeq/events/eventNumbers/eventSchemaVersion/titleTransitions/
  // historicalFighterIdentities (Universe Events V1): same "truly starting
  // from nothing" reasoning extends to the event layer -- a brand-new
  // universe has no cards and no title-transition facts yet either.
  // IMPORTANT: this function is called from TWO places -- initCareer (a
  // genuine fresh start, nothing to carry forward) and
  // resolveWeightMoveOffer (a weight-class move, which is NOT a fresh
  // start for history purposes even though the ROSTERS are brand new).
  // buildFreshUniverse itself stays simple and always returns a blank
  // event/bout history -- resolveWeightMoveOffer is responsible for
  // overwriting these fields with the outgoing universe's carried-forward
  // history afterward (see its own comment). Never carry history forward
  // IN here -- this function has no way to tell which caller it's serving.
  return {
    schemaVersion: UNIVERSE_SCHEMA_VERSION, fighterSeq, rngState, divisions,
    worldTickSeq: 0, boutSeq: 0, bouts: [],
    eventSeq: 0, events: [], eventNumbers: freshEventNumbers(), eventSchemaVersion: EVENT_SCHEMA_VERSION,
    titleTransitionSeq: 0, titleTransitions: [],
    historicalFighterIdentities: {},
  };
}

// ---- Single source of truth ---------------------------------------------
// state.universe.divisions[key] is the authoritative store.
// state.divisionRoster remains a synchronized convenience alias for
// whichever division is currently ACTIVE (state.circuitTier) -- kept
// because ~40 existing call sites across career.js and App.jsx already
// read it directly, and rewriting every one of them carries real risk for
// no behavioral benefit (see this branch's own report). It is NEVER
// independently assigned anywhere else in this file; every write to the
// active division goes through this one helper, so the two can never
// drift apart into two independently-mutable copies.
function syncActiveDivision(s, newRoster) {
  s.divisionRoster = newRoster;
  if (s.universe) {
    // Routed through persistentTierForActiveRoster -- NOT a no-op guard.
    // commitFight's own post-fight "update the persistent division" step
    // (the National opponent's record/form update + simulateDivisionRound)
    // calls this AFTER s.circuitTier has already been flipped to "CLF
    // Contender Series" on the exact fight that wins the National -> CS
    // invite (see leftBeltBehindForContenderSeries there: that fight is a
    // National fight, isContenderSeriesFight is false for it, so this DOES
    // run, with the NEW tier already in state.circuitTier). Without this
    // translation, circuitToUniverseKey(s.circuitTier) would be null there
    // (pre-hardening it silently defaulted to "regional") and this exact
    // post-fight update -- the newly-fought opponent's record, the
    // simulated division round, a title change of hands -- would either be
    // silently DROPPED (with a bare null-key guard) or written into the
    // WRONG division entirely (the old "regional" default). Translating
    // through persistentTierForActiveRoster lands it correctly on
    // "national", which is what the roster being passed in actually is.
    const key = circuitToUniverseKey(persistentTierForActiveRoster(s.circuitTier));
    if (key) {
      s.universe = { ...s.universe, divisions: { ...s.universe.divisions, [key]: newRoster } };
    }
  }
}
// The accessor future code should prefer over reading state.divisionRoster
// directly. Unlike a plain pass-through, this resolves state.universe's
// own copy FIRST whenever one exists -- the authoritative source -- and
// only falls back to the divisionRoster alias when no universe exists yet
// (a pre-Foundation-V1 save) or the active tier has no persistent division
// (Contender Series, via persistentTierForActiveRoster's National
// redirect, still lands on the authoritative universe copy in that case).
//
// This is NOT a cosmetic distinction. In live memory, divisionRoster and
// universe.divisions[key] are always the SAME object reference (see
// syncActiveDivision above, the only place either is ever written), so
// reading either one is equivalent today. But JSON.stringify/JSON.parse --
// the mechanism behind any future save/reload -- preserves DATA, not JS
// reference identity: `JSON.parse(JSON.stringify(state))` produces a state
// where divisionRoster and universe.divisions[key] are two DIFFERENT
// objects that merely happen to contain equal data at that instant, not
// two names for the same object anymore. If a rehydrated state were then
// mutated through only ONE of those two references (plausible for a
// future Save/Resume pass that doesn't happen to call syncActiveDivision
// again immediately), the other would silently go stale. Resolving through
// universe.divisions[key] here means that risk can never surface through
// this accessor, regardless of whether the alias has been explicitly
// rebound after a reload (see normalizeUniverseState below, which rebinds
// the alias itself for the ~40 existing call sites that still read
// divisionRoster directly instead of through this function).
function getActiveDivision(state) {
  const key = circuitToUniverseKey(persistentTierForActiveRoster(state.circuitTier));
  if (key && state.universe && state.universe.divisions && state.universe.divisions[key]) {
    return state.universe.divisions[key];
  }
  return state.divisionRoster;
}
// Looks up a division by tier WITHOUT switching the player into it --
// this is what lets tier promotion (see commitFight's resetForFreshTier
// block) hand the player the world that's already been sitting there
// since career start, instead of generating a fresh one. Old-save-safe:
// a state with no `universe` yet (pre-Foundation-V1) falls back to the
// single existing divisionRoster if it happens to already match the
// requested tier, or null otherwise -- exactly as calling code already
// had to handle "this division doesn't exist yet" before this pass.
//
// Contender Series has no persistent division (circuitToUniverseKey
// returns null for it) and this function must say so plainly -- an
// explicit `key === null` guard returns null immediately, BEFORE the
// old-save fallback line below ever runs. Without this guard, the fallback
// (`circuitToUniverseKey(state.circuitTier) === key`) would compare
// `null === null` and evaluate true whenever the CALLER also happens to be
// mid-CS, wrongly handing back whatever divisionRoster currently holds --
// exactly the "CS silently resolves as if it were Regional" failure this
// hardening pass exists to rule out.
function getDivisionForTier(state, circuitTier) {
  const key = circuitToUniverseKey(circuitTier);
  if (key === null) return null;
  if (state.universe && state.universe.divisions && state.universe.divisions[key]) {
    return state.universe.divisions[key];
  }
  if (circuitToUniverseKey(state.circuitTier) === key && state.divisionRoster) return state.divisionRoster;
  return null;
}

// ---- Explicit rehydration --------------------------------------------------
// What happens after JSON reload? getActiveDivision (above) already
// answers that question correctly by itself -- it re-derives the active
// roster from state.universe every time, so it can never return stale data
// even if divisionRoster and universe.divisions[key] are, after a
// JSON.parse, two separate objects that merely contain equal data rather
// than the same object. But ~40 existing call sites across this file and
// App.jsx still read state.divisionRoster DIRECTLY, not through
// getActiveDivision, and this pass deliberately does not rewrite all of
// them (see this branch's own report on why that's unnecessary risk for
// no behavioral benefit). This function is the other half of the answer:
// call it once, immediately after any external rehydration of a Career
// state (JSON.parse of a saved/transmitted state today; a future
// Save/Resume load is the concrete case this exists for), and it
// explicitly REBINDS state.divisionRoster to literally be
// state.universe.divisions[key] again -- restoring true reference
// equality, not just equal values, so every one of those ~40 direct-read
// call sites is safe again too, with zero of them needing to change.
// Idempotent and safe to call on a state that's already correctly bound
// (rebinding to the same reference twice is a no-op), on an old
// pre-Foundation-V1 state (no state.universe -- returns unchanged), or on
// a state that's mid-Contender-Series (routes through
// persistentTierForActiveRoster so it rebinds to the real National roster,
// not a null/missing key). Never mutates state.universe.divisions itself
// -- only ever repoints the divisionRoster alias to what's already there.
// Universe Events V1: migrateUniverseEvents is folded into this same
// always-called-on-rehydration function rather than given its own
// separate call site -- normalizeUniverseState is already the established
// "run this once after any external rehydration, safe to call repeatedly"
// hook (see its own comment above), and migrateUniverseEvents is
// internally idempotent (guarded by eventSchemaVersion) the exact same
// way, so piggybacking here needs no new wiring anywhere else in
// career.js or App.jsx.
function normalizeUniverseState(state) {
  if (!state.universe) return state;
  let s = state;
  const migratedUniverse = migrateUniverseEvents(s.universe, s.division);
  if (migratedUniverse !== s.universe) s = { ...s, universe: migratedUniverse };
  if (!s.universe.divisions) return s;
  const key = circuitToUniverseKey(persistentTierForActiveRoster(s.circuitTier));
  if (!key || !s.universe.divisions[key]) return s;
  return { ...s, divisionRoster: s.universe.divisions[key] };
}

// ---- Active-save migration ------------------------------------------------
// Old Career state (pre-Foundation-V1) contains only state.divisionRoster
// for whichever tier is currently active, and no state.universe at all.
// This upgrades such a state in place: the existing active roster is
// preserved EXACTLY (never regenerated, never re-ided), placed into its
// matching universe slot, and the two MISSING tiers are generated fresh
// using ONLY the isolated universe RNG (never Math.random) so a save
// migrated mid-session can't have its next player fight perturbed by
// catch-up generation. No history is fabricated for the missing tiers --
// they simply start as fresh current-snapshot rosters, with no bout/event
// ledger pretending years of past activity already happened (there is no
// ledger at all yet in this phase -- see this branch's own report on why
// Phase 2 introduces one instead of unrecorded background mutation).
// Idempotent: a state that already has a current-schema universe is
// returned completely unchanged, so this is always safe to call.
function migrateStateToUniverse(state, seed) {
  if (state.universe && state.universe.schemaVersion === UNIVERSE_SCHEMA_VERSION) return state;
  const s = { ...state };
  // Routed through persistentTierForActiveRoster so a save migrated
  // mid-Contender-Series lands its real, current roster in the "national"
  // slot it actually belongs to. Without this translation,
  // circuitToUniverseKey(s.circuitTier) on a CS-in-progress save would
  // return null (or, pre-hardening, silently "regional") -- either way
  // placing the player's actual National roster under the WRONG key and
  // then having the loop below freshly regenerate a brand-new National
  // division to fill the real slot, discarding the genuine one. The
  // trailing `|| "regional"` is the same last-resort defensive fallback as
  // buildFreshUniverse's, never expected to trigger on any real save.
  const activeKey = circuitToUniverseKey(persistentTierForActiveRoster(s.circuitTier)) || "regional";
  // The existing active roster's fighters keep their current `div-<i>-...`
  // ids completely untouched -- no rewrite of historical/current NPC
  // identity. Only the freshly-generated missing tiers below get the new
  // `fighter-<seq>` scheme; the two id shapes can never collide (different
  // string prefixes), so starting the sequence at 0 here is safe.
  let fighterSeq = 0;
  let rngState = seed;
  const divisions = { [activeKey]: s.divisionRoster };
  ["CLF Regional", "CLF National", "CLF PREMIER"].forEach((tier) => {
    const key = circuitToUniverseKey(tier);
    if (key === activeKey) return; // preserved above, untouched
    const result = buildDivisionWithUniverseRng(tier, rngState);
    rngState = result.nextRngState;
    const idResult = assignUniverseFighterIds(result.division, fighterSeq);
    divisions[key] = idResult.division;
    fighterSeq = idResult.nextFighterSeq;
  });
  // worldTickSeq/boutSeq/bouts: a migrated old-shape save never had a bout
  // ledger, so it starts one fresh here -- same reasoning as
  // buildFreshUniverse's own explicit 0/0/[]. No history is fabricated for
  // fights that happened before this feature existed; the ledger is
  // truthful from the moment World Movement actually starts running, not
  // reconstructed retroactively.
  // Same reasoning as buildFreshUniverse's own event-field defaults: a
  // migrated ancient (pre-Foundation-V1) save never had a bout ledger at
  // all, so there is nothing for the event layer to backfill either --
  // it starts truthfully empty, at the current eventSchemaVersion (so
  // normalizeUniverseState's migrateUniverseEvents call below correctly
  // treats it as already-migrated, not as a #38-era save needing backfill).
  s.universe = {
    schemaVersion: UNIVERSE_SCHEMA_VERSION, fighterSeq, rngState, divisions,
    worldTickSeq: 0, boutSeq: 0, bouts: [],
    eventSeq: 0, events: [], eventNumbers: freshEventNumbers(), eventSchemaVersion: EVENT_SCHEMA_VERSION,
    titleTransitionSeq: 0, titleTransitions: [],
    historicalFighterIdentities: {},
  };
  return s;
}

// =========================================================================
//  NPC WORLD MOVEMENT + BOUT LEDGER V1
// =========================================================================
// Persistent Universe Foundation V1 gave Regional/National/Premier a
// persistent roster each, but only the player's own active tier ever
// moved -- via commitFight's old simulateDivisionRound (removed by this
// pass), one flat "round" of movement per player fight, applied ONLY to
// whichever division happened to be s.divisionRoster at that exact moment,
// scoped to the champion + 15 ranked pool alone (the unranked tier below
// was never touched by it at all). The other two persistent tiers sat
// completely frozen the entire time the player fought elsewhere.
//
// This pass replaces that model, not merely extends it, with one that
// runs identically for all three persistent tiers every world tick and
// makes every meaningful resulting mutation traceable to an actual
// persisted bout (universe.bouts) rather than an unrecorded record.w += 1.
// Concretely:
//   - universe.worldTickSeq increments exactly once per COMMITTED PLAYER
//     FIGHT (any tier, Contender Series included) -- the player's own
//     fight is the universe's passage-of-time anchor.
//   - Regional, National, AND Premier each get one round of background
//     bouts per tick, regardless of which tier the player's fight was in
//     (a promotion fight must not let National activity replace Regional
//     activity, or vice versa -- see runWorldTick/commitFight below).
//   - Every background bout (and, starting with this pass, the player's
//     own committed fight too) is appended to universe.bouts under a
//     monotonic bout-N id (universe.boutSeq), with enough historical
//     context (rank/record BEFORE the fight, not derivable from current
//     state later) that a future Event Archive / Title Lineage / Fighter
//     History pass can render an old card truthfully instead of guessing
//     from whatever the fighters' CURRENT standing happens to be.
//   - The unranked tier now actually matters: a Hot Prospect or Ranking-
//     Bubble fighter can break into the Top 15 by beating a real
//     bottom-of-the-ladder ranked fighter in the background, and a
//     struggling ranked veteran can fall the other way -- without ever
//     fighting the player.
// Contender Series remains exactly what it already was -- a temporary,
// non-persistent showcase pipeline (see circuitToUniverseKey) -- it never
// gets its own background bouts; the three PERSISTENT circuits still
// advance every tick regardless of a CS fight happening that tick.
//
// RNG isolation: every background bout, for every tier, on every tick,
// runs through the SAME isolated, serializable universe RNG
// (nextUniverseRandom/universe.rngState) that Foundation V1's own
// generation already used -- via the identical scoped Math.random swap
// adapter that buildDivisionWithUniverseRng established (see
// runWorldTickForDivision below), never the player's own Math.random
// stream. This is a direct extension of that same adapter to ongoing
// background simulation, exactly the "future NPC world simulation should
// call the serialized universe RNG directly" note Foundation V1's own
// report already flagged -- not a new exception to the isolation
// principle it established.

// Reserved career-local participant id for the player's own bouts in the
// universe ledger. Can never collide with an NPC id: every NPC id is
// either `fighter-<n>` (current universe-wide scheme) or, for an
// old-save-migrated active roster, `div-<n>-<slug>` -- neither shape can
// ever equal the bare string "player".
const PLAYER_BOUT_ID = "player";

// Assigns monotonic bout-<n> ids to a batch of freshly-resolved bouts in
// one pass, threading the sequence value explicitly through the call --
// same pattern as assignUniverseFighterIds, for the same reason: never a
// shared mutable counter, so it stays serialization-safe and reproducible.
function assignBoutIds(newBouts, boutSeq) {
  let seq = boutSeq || 0;
  const withIds = newBouts.map((b) => {
    seq += 1;
    return { id: `bout-${seq}`, ...b };
  });
  return { bouts: withIds, nextBoutSeq: seq };
}

// Appends one already-resolved bout (the player's own committed fight) to
// the ledger under the next bout id. Kept separate from the background-tick
// batch append (assignBoutIds is reused by both) so the player's own fight
// always gets appended -- and therefore always gets the lowest bout id --
// for the tick it belongs to, before that tick's background bouts are
// generated: a stable, predictable "the player's own result leads this
// tick's ledger entries" ordering, not load-bearing for correctness but a
// sensible, deterministic convention for any future reader.
function appendPlayerBout(universe, boutFields) {
  const { bouts: idBouts, nextBoutSeq } = assignBoutIds([boutFields], universe.boutSeq);
  return { ...universe, boutSeq: nextBoutSeq, bouts: [...(universe.bouts || []), ...idBouts] };
}

// Lightweight universe bout resolver -- deliberately NOT the player's full
// round-by-round combat simulator (resolveFight/simulateRounds, both
// completely untouched by this pass). Reuses computeWinProbability and
// computeFinishOdds UNCHANGED -- the exact same formulas the player's own
// pre-fight preview and simulation read -- so background results stay
// recognizably the same kind of MMA this engine already produces, without
// paying for round-by-round fatigue/damage state, scorecards, or narrative
// nobody will ever read for a fight that isn't the player's own. Phase
// assumption is neutral (stanceBias 0 -- neither NPC has a player-only
// gameplan concept) and reachScore is the same 75 baseline
// computeWinProbability itself already treats as "no reach edge either
// way" -- acceptable simplifications for a lightweight resolver, not a
// second combat model competing with the real one.
//
// Swaps Math.random to rngFn for its own duration (the identical adapter
// pattern buildDivisionWithUniverseRng already established) so it's safe
// to call standalone with a controlled rngFn (tests do exactly this) as
// well as from inside an already-swapped caller like
// runWorldTickForDivision below -- nesting the same swap twice is a no-op,
// not a bug.
function resolveLightweightBout(attrsA, attrsB, isTitleFight, rngFn) {
  const original = Math.random;
  Math.random = rngFn;
  try {
    const phase = estimatePhaseControl(attrsA, attrsB, 0);
    const REACH_NEUTRAL = 75;
    const probA = computeWinProbability(attrsA, attrsB, phase, REACH_NEUTRAL);
    const aWins = Math.random() < probA;
    const winnerAttrs = aWins ? attrsA : attrsB;
    const loserAttrs = aWins ? attrsB : attrsA;
    const odds = computeFinishOdds(winnerAttrs, loserAttrs, phase);
    const totalRounds = isTitleFight ? 5 : 3;
    // Single-roll stand-in for simulateRounds' round-by-round damage
    // accumulation -- calibrated by direct measurement against the player
    // engine's own method/finish-rate output (see this branch's own
    // report), not an exact statistical clone of it, which a lightweight
    // resolver is explicitly not required to be.
    const finishChance = clamp((odds.koPotential + odds.subPotential) / WORLD_BOUT_FINISH_DIVISOR, 0.05, 0.55);
    const isFinish = Math.random() < finishChance;
    let method = "Decision", round = totalRounds;
    if (isFinish) {
      method = rollMethod(odds);
      round = pickWeightedFinishRound(totalRounds);
    }
    return { aWins, method, round };
  } finally {
    Math.random = original;
  }
}
// Tuned so the lightweight resolver's Decision/KO-TKO/Submission split and
// favorite-win-rate-by-probability-bucket broadly track the player engine's
// own (see this branch's own report for the measured comparison) --
// touched only if that measurement calls for it, never to chase an exact
// statistical match (out of scope for a lightweight resolver).
const WORLD_BOUT_FINISH_DIVISOR = 145;

// Front-loaded but not extreme -- broadly matches real MMA's tendency for
// finishes to cluster early-to-middle rather than being spread uniformly
// across rounds or purely round-1-or-bust. Called only from inside
// resolveLightweightBout, after Math.random is already swapped to the
// active rngFn there.
function pickWeightedFinishRound(totalRounds) {
  const weights = totalRounds >= 5 ? [0.28, 0.24, 0.20, 0.16, 0.12] : [0.42, 0.34, 0.24];
  const r = Math.random();
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (r < acc) return i + 1;
  }
  return totalRounds;
}

// Roster Ecology V1's tag is generation-origin metadata, not a permanent
// caste (see its own comment on createEcologyFighter) -- ranked/champion
// fighters carry no ecology tag at all, and a fighter who drops OUT of the
// ranked pool via a background boundary-bout loss needs a believable one
// so they're not invisible to ecology-aware candidate pools
// (eligibleEcologyPool/pickEcologyCandidate) they just became eligible
// for again. A small, defensible heuristic off their OWN real record --
// never a coin flip, never their old ranked-pool identity carried over
// unearned.
function ecologyForDemotedFighter(fighter) {
  const wins = fighter.record.w, losses = fighter.record.l;
  const experience = wins + losses;
  if (experience >= 20) return "VETERAN_GATEKEEPER";
  if (wins - losses >= 4 && experience <= 12) return "HOT_PROSPECT";
  if (wins >= losses) return "SOLID_UNRANKED";
  return "DEVELOPMENTAL";
}

// Cadence chosen after the pre-PR realism hardening pass re-measured the
// originally-shipped MODERATE model (below) at ~0.4-0.6 fights/fighter/yr
// and ~2.4-3.1 title fights/10y/tier -- structurally correct but too
// static for a "living" universe -- and prototyped three stronger
// candidates across 80 simulated careers apiece (avg ~9.6 years, ~18
// world ticks/career -- see this branch's own report for the full
// per-ecology/per-rank breakdown):
//   MODERATE (originally shipped): titleChance .14-.16, vacancyChance
//           .80-.85, 2/2/3-4 bouts -- ~0.44-0.61 fights/fighter/yr;
//           2.4-3.1 title fights/10y/tier; 0% of HOT_PROSPECT fighters
//           ever reached a Top-15 ranking in the whole measured window
//           (a separate boundary-movement eligibility gap, fixed
//           alongside this retune -- see runWorldTickForDivision's
//           boundary-movement section).
//   MODEL D "MODERATE+" (titleChance .30-.34, vacancyChance .90-.92,
//           4/3/6-7 bouts): ~0.82-1.14 fights/fighter/yr; ~6-6.5 title
//           fights/10y/tier.
//   MODEL E "ACTIVE" (shipped, below: titleChance .36-.40, vacancyChance
//           .92-.95, 5/4/8-9 bouts): ~0.96-1.37 fights/fighter/yr (most
//           of the roster lands in the 1.0-1.99/yr distribution bucket);
//           ~6.6-7.9 title fights/10y/tier; 43% of HOT_PROSPECT fighters
//           reach a Top-15 ranking (median ~7 ticks / ~5 fights to first
//           ranking) entirely in the background; ranked fighters in the
//           8-15 range see a rank drop 37% of the time and a Top-15 exit
//           25% of the time -- genuine two-way movement, not a one-way
//           ratchet.
//   MODEL F "HIGH-ACTIVITY" (titleChance .42-.46, vacancyChance .95-.97,
//           7/5/11-13 bouts): ~1.20-1.69 fights/fighter/yr; ~8.2-8.9
//           title fights/10y/tier -- roughly another ~40% more ledger
//           volume than MODEL E for comparatively little further gain in
//           believability (Hot Prospect Top-15 entry actually drops
//           slightly, 39% vs 43%, from more crowded ranked-ladder churn).
// MODEL E is selected: it clears every Section 38 target (a Hot Prospect
// can build a real 5-year résumé; ranked veterans genuinely rise and
// fall; Premier rankings visibly move; a multi-year title reign still
// contains real defenses) without MODEL F's extra ~40% ledger-volume cost
// to the completed-archive storage budget (see this branch's own report,
// Section 13-19) for a believability gain that measurement did not show.
// titleChance is the odds a tier with an NPC champion gets a title fight
// THIS tick; vacancyChance is the (deliberately higher) odds a genuinely
// vacant belt gets contested this tick, so a title the player left behind
// doesn't sit vacant indefinitely. rankedBouts/boundaryBouts/unrankedBouts
// are bout COUNTS per tick, not chances.
const WORLD_TICK_CADENCE = {
  "CLF Regional": { titleChance: 0.36, vacancyChance: 0.92, rankedBouts: 5, boundaryBouts: 4, unrankedBouts: 9 },
  "CLF National": { titleChance: 0.38, vacancyChance: 0.92, rankedBouts: 5, boundaryBouts: 4, unrankedBouts: 8 },
  "CLF PREMIER": { titleChance: 0.40, vacancyChance: 0.95, rankedBouts: 5, boundaryBouts: 4, unrankedBouts: 8 },
};

// Small rematch-recency guard (Section 22-25 of the underlying task) --
// deliberately NOT rivalry matchmaking. Prototyped N=1/2/3 across 20
// simulated careers (15 player fights each) at the new MODEL E activity
// cadence above (this branch's own report has the full before/after
// numbers): N=1 turned out to be a no-op (a pairing from exactly one
// tick ago is never actually "within the last 1 tick" by the time the
// next tick runs); N=2 cut immediate/next-tick rematches by ~84% and
// repeats-within-2-ticks by ~82% versus no cooldown, while N=3 pushed
// further into candidate-starvation territory (a visibly higher max
// repeated pairing and more frequent same-night-adjacent fallback) for
// only a modest further gain. N=2 is selected. A pairing is "on
// cooldown" if the same two fighters already fought each other, in this
// tier, within the last REMATCH_COOLDOWN_TICKS world ticks -- sourced
// directly from the persisted bout ledger (universe.bouts), which is
// already the single source of historical truth here; no redundant
// `lastOpponentIds` field is added to the fighter record for this (see
// Section 25 of the underlying task -- querying the ledger for this
// measured cheap enough, at these universe sizes, not to need one; see
// this branch's own report for the measured cost).
const REMATCH_COOLDOWN_TICKS = 2;

function pairKey(idA, idB) {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

// Builds the set of pairings that fought each other, IN THIS TIER, within
// the last REMATCH_COOLDOWN_TICKS world ticks -- called once per tier per
// tick from runWorldTick, before that tier's own runWorldTickForDivision
// call, so the ledger scan happens exactly once per tier per tick rather
// than once per candidate pairing considered.
function recentPairingsForTier(bouts, tierName, worldTick) {
  const set = new Set();
  (bouts || []).forEach((b) => {
    if (b.circuit !== tierName) return;
    // "fought within the last N world ticks" -- gap of N or fewer ticks
    // ago is on cooldown; gap is always >= 1 here since this is called
    // before this tick's own bouts exist yet.
    if (worldTick - b.worldTick > REMATCH_COOLDOWN_TICKS) return;
    if (b.fighterAId === PLAYER_BOUT_ID || b.fighterBId === PLAYER_BOUT_ID) return;
    set.add(pairKey(b.fighterAId, b.fighterBId));
  });
  return set;
}
function isRecentPairing(recentPairings, idA, idB) {
  return recentPairings.has(pairKey(idA, idB));
}

// Runs ONE tier's background activity for ONE world tick. Pure: returns a
// new division array + the bouts it produced + the advanced rngState,
// never mutates its inputs. excludeIds keeps the player's own just-fought
// opponent out of an ADDITIONAL background booking this same tick (no
// same-night double fights -- see this branch's own report); harmless/
// inert for a tier the player isn't in, and for Contender Series opponents
// (never part of any persistent roster, so their id never matches anyone
// here anyway).
function runWorldTickForDivision(division, tierName, playerHoldsBelt, excludeIds, year, worldTick, rngState, recentPairings, weightClass) {
  const recent = recentPairings || new Set();
  const cadence = WORLD_TICK_CADENCE[tierName] || WORLD_TICK_CADENCE["CLF Regional"];
  let state = rngState;
  const rngFn = () => {
    const { value, nextState } = nextUniverseRandom(state);
    state = nextState;
    return value;
  };
  const original = Math.random;
  Math.random = rngFn;
  try {
    const d = division.map((f) => ({ ...f, record: { ...f.record } }));
    const used = new Set(excludeIds || []);
    const bouts = [];

    function rankOf(fighter) {
      const idx = d.indexOf(fighter);
      return idx === -1 ? null : displayRankFor(d, idx);
    }
    function pushBout(aFighter, bFighter, aWins, method, round, titleFight, championBeforeId) {
      bouts.push({
        circuit: tierName, year, worldTick,
        // Universe Events V1, Section 28: the weight class this bout
        // actually happened in -- immutable historical identity, needed
        // so a future card label can distinguish "CLF Premier 14" fought
        // at Welterweight from a same-numbered-tier card years later at
        // Middleweight after a weight-class move. Never re-derived from
        // current state.division, which can have moved on by the time
        // anything reads this bout back.
        division: weightClass,
        fighterAId: aFighter.id, fighterBId: bFighter.id,
        winnerId: aWins ? aFighter.id : bFighter.id,
        method, round, titleFight: !!titleFight,
        championBeforeId: championBeforeId ?? null,
        rankABefore: rankOf(aFighter), rankBBefore: rankOf(bFighter),
        recordABefore: { ...aFighter.record }, recordBBefore: { ...bFighter.record },
      });
    }
    // Mutates the winner/loser fighter objects IN PLACE (they're already
    // the exact objects sitting in `d`, so this is how a position swap
    // elsewhere in this function picks up the updated record for free) --
    // never suppressed by a win-rate floor the way the old
    // applyRoundLoss/simulateDivisionRound model protected ranked records
    // from repeated-coin-flip erosion. That protection doesn't carry over
    // here on purpose: every result in this pass is ledger-backed, real
    // history now, and a floor that silently declined to record a loss
    // that DID happen would break the record-reconciliation invariant
    // (baseline + ledger wins/losses = current record) this branch's own
    // report explicitly validates. A ranked fighter's record can now
    // genuinely drift through a rough patch, same as it would for a real
    // fighter -- see this branch's own report for the measured effect.
    function applyResult(aFighter, bFighter, aWins) {
      const winner = aWins ? aFighter : bFighter, loser = aWins ? bFighter : aFighter;
      winner.record = { w: winner.record.w + 1, l: winner.record.l };
      pushForm(winner, true);
      loser.record = { w: loser.record.w, l: loser.record.l + 1 };
      pushForm(loser, false);
    }

    // ---- title / vacancy slot -------------------------------------------
    const champIdx = d.findIndex((f) => f.isChampion);
    if (champIdx !== -1) {
      const champ = d[champIdx];
      if (!used.has(champ.id) && Math.random() < cadence.titleChance) {
        let challengerIdx = -1;
        for (let i = 1; i <= Math.min(DIVISION_SIZE, d.length - 1); i++) {
          if (!used.has(d[i].id)) { challengerIdx = i; break; }
        }
        if (challengerIdx !== -1) {
          const challenger = d[challengerIdx];
          const { aWins, method, round } = resolveLightweightBout(champ.attrs, challenger.attrs, true, Math.random);
          pushBout(champ, challenger, aWins, method, round, true, champ.id);
          used.add(champ.id); used.add(challenger.id);
          applyResult(champ, challenger, aWins);
          if (!aWins) {
            champ.isChampion = false;
            challenger.isChampion = true;
            d[champIdx] = challenger; d[challengerIdx] = champ;
          }
        }
      }
    } else if (!playerHoldsBelt && Math.random() < cadence.vacancyChance) {
      // Section 18/19: the player left this tier's belt behind (or it was
      // never earned since), and nobody in the roster holds it either --
      // a genuine vacancy. Contested between the top two eligible ranked
      // fighters, same as any other title fight, just with no defending
      // champion and no championBeforeId (truthfully null -- a future
      // Title Lineage pass needs to be able to tell "successful defense"
      // apart from "vacant-title win" apart from "title change," which is
      // exactly why this field exists).
      const candidates = [];
      for (let i = 0; i <= Math.min(DIVISION_SIZE, d.length - 1) && candidates.length < 2; i++) {
        if (!used.has(d[i].id)) candidates.push(i);
      }
      if (candidates.length === 2) {
        const [aIdx, bIdx] = candidates;
        const a = d[aIdx], b = d[bIdx];
        const { aWins, method, round } = resolveLightweightBout(a.attrs, b.attrs, true, Math.random);
        pushBout(a, b, aWins, method, round, true, null);
        used.add(a.id); used.add(b.id);
        applyResult(a, b, aWins);
        const winnerIdx = aWins ? aIdx : bIdx;
        d[winnerIdx] = { ...d[winnerIdx], isChampion: true };
      }
    }

    // ---- ranked-ladder movement ------------------------------------------
    const rankedStartNow = d.findIndex((f) => f.isChampion) === -1 ? 0 : 1;
    const rankedEnd = Math.min(DIVISION_SIZE, d.length - 1);
    for (let n = 0; n < cadence.rankedBouts; n++) {
      let picked = null;
      for (let attempt = 0; attempt < 6 && !picked; attempt++) {
        const i = rankedStartNow + Math.floor(Math.random() * Math.max(1, rankedEnd - rankedStartNow));
        const j = i + 1;
        if (j > rankedEnd) continue;
        if (used.has(d[i].id) || used.has(d[j].id)) continue;
        if (isRecentPairing(recent, d[i].id, d[j].id)) continue;
        picked = [i, j];
      }
      if (!picked) {
        // Fallback: the ranked ladder is a narrow, adjacent-pair pool --
        // a genuine cooldown-clear pair can be unavailable this tick. No
        // permanent rematch ban (Section 22-25): take any still-open
        // adjacent pair even if it repeats, rather than losing the slot.
        for (let attempt = 0; attempt < 6 && !picked; attempt++) {
          const i = rankedStartNow + Math.floor(Math.random() * Math.max(1, rankedEnd - rankedStartNow));
          const j = i + 1;
          if (j > rankedEnd) continue;
          if (used.has(d[i].id) || used.has(d[j].id)) continue;
          picked = [i, j];
        }
      }
      if (!picked) continue;
      const [i, j] = picked;
      const a = d[i], b = d[j];
      const { aWins, method, round } = resolveLightweightBout(a.attrs, b.attrs, false, Math.random);
      pushBout(a, b, aWins, method, round, false, null);
      used.add(a.id); used.add(b.id);
      applyResult(a, b, aWins);
      if (!aWins) { d[i] = b; d[j] = a; } // upset moves them up the ladder
    }

    // ---- unranked <-> ranked boundary movement ---------------------------
    // A real path into the Top 15 without ever fighting the player --
    // section 21/22 of the underlying task. RANKING_BUBBLE-tagged unranked
    // fighters get this shot (a believable "knocking on the door"
    // candidate, not a random developmental fighter) against the bottom of
    // the ranked ladder -- and so do HOT_PROSPECT fighters: a fighter that
    // ecology generation itself defines as wins-losses>=4 within their
    // first ~12 fights (see the ECOLOGY_PROFILES table) is exactly a "on a
    // tear, ready to test the ranked ladder" prospect, and excluding them
    // here (as an earlier version of this pass did) meant NO Hot Prospect
    // could ever background-path into a ranking at all -- a real gap
    // against the "7-0 -> gatekeeper win -> #15 test -> ranked" contender
    // arc the pre-PR hardening pass measured and flagged. A win swaps them
    // in; the loser drops to the front of the unranked pool with a
    // freshly-assigned ecology tag (see ecologyForDemotedFighter) -- their
    // stable id/record/form all survive the move untouched, only their
    // ladder position and ecology label change.
    for (let n = 0; n < cadence.boundaryBouts; n++) {
      let bottomIdx = -1;
      for (let i = rankedEnd; i >= Math.max(rankedStartNow, rankedEnd - 3); i--) {
        if (!used.has(d[i].id)) { bottomIdx = i; break; }
      }
      if (bottomIdx === -1) continue;
      const bubblePool = d.slice(rankedEnd + 1).filter((f) => (f.ecology === "RANKING_BUBBLE" || f.ecology === "HOT_PROSPECT") && !used.has(f.id));
      if (!bubblePool.length) continue;
      const incumbent = d[bottomIdx];
      // Prefer a challenger this incumbent hasn't just fought; fall back to
      // the full pool (no permanent ban) if the cooldown would otherwise
      // starve this bubble-pool candidate slot entirely.
      const nonRecentBubble = bubblePool.filter((f) => !isRecentPairing(recent, incumbent.id, f.id));
      const bubbleCandidates = nonRecentBubble.length ? nonRecentBubble : bubblePool;
      const challenger = bubbleCandidates[Math.floor(Math.random() * bubbleCandidates.length)];
      const challengerIdx = d.indexOf(challenger);
      const { aWins, method, round } = resolveLightweightBout(incumbent.attrs, challenger.attrs, false, Math.random);
      pushBout(incumbent, challenger, aWins, method, round, false, null);
      used.add(incumbent.id); used.add(challenger.id);
      applyResult(incumbent, challenger, aWins);
      if (!aWins) {
        d[bottomIdx] = { ...challenger, ecology: undefined };
        d[challengerIdx] = { ...incumbent, ecology: ecologyForDemotedFighter(incumbent) };
      }
    }

    // ---- unranked-pool activity -------------------------------------------
    // Quality-adjacent pairing (sorted by overall, adjacent picks) rather
    // than pure random pairing across the whole unranked tier -- a
    // HOT_PROSPECT vs a DEVELOPMENTAL fighter is not a believable booking.
    // Keeps records/form moving for the population that never touches the
    // ranked ladder directly, so the roster reads as active rather than
    // half of it sitting untouched for years.
    for (let n = 0; n < cadence.unrankedBouts; n++) {
      const pool = d.slice(rankedEnd + 1).filter((f) => !used.has(f.id));
      if (pool.length < 2) continue;
      const sorted = [...pool].sort((a, b) => a.overall - b.overall);
      let startIdx = -1;
      for (let attempt = 0; attempt < 6; attempt++) {
        const idx = Math.floor(Math.random() * Math.max(1, sorted.length - 1));
        const candA = sorted[idx], candB = sorted[Math.min(idx + 1, sorted.length - 1)];
        if (candA.id === candB.id) continue;
        if (isRecentPairing(recent, candA.id, candB.id)) continue;
        startIdx = idx; break;
      }
      // Fallback: quality-adjacent pairing over a small unranked pool can
      // exhaust every cooldown-clear adjacent pair; take any adjacent pair
      // rather than skip the slot (no permanent ban).
      if (startIdx === -1) startIdx = Math.floor(Math.random() * Math.max(1, sorted.length - 1));
      const a = sorted[startIdx], b = sorted[Math.min(startIdx + 1, sorted.length - 1)];
      if (a.id === b.id) continue;
      const { aWins, method, round } = resolveLightweightBout(a.attrs, b.attrs, false, Math.random);
      pushBout(a, b, aWins, method, round, false, null);
      used.add(a.id); used.add(b.id);
      applyResult(a, b, aWins);
    }

    return { division: d, bouts, nextRngState: state };
  } finally {
    Math.random = original;
  }
}

// Applies the player's own opponent's record/form update, plus (if this
// fight was a title change/defense) the belt-swap/demotion, directly to
// state.universe.divisions[tierBeforeKey] -- replacing the old
// `nextDivision = s.divisionRoster.map(...)` approach, which read/wrote
// through the ACTIVE-division alias and could silently target the WRONG
// tier on a same-fight promotion (see this branch's own report, and
// circuitToUniverseKey's own hardening history for the same class of
// bug). tierBeforeKey is resolved from tierBefore -- the tier the fight
// ACTUALLY happened in, captured before any promotion logic in commitFight
// changes s.circuitTier -- never from the possibly-already-switched
// s.divisionRoster/s.circuitTier. skipRankUpdate mirrors commitFight's own
// existing resetForFreshTier/leftBeltBehindForContenderSeries guard
// exactly (same reasoning, same bug this guard originally fixed -- see
// commitFight's own comment on it).
function applyPlayerOpponentUpdateToUniverse(universe, tierBeforeKey, oppEntry, result, isTitleShot, isTitleDefense, skipRankUpdate) {
  const division = universe.divisions[tierBeforeKey];
  if (!division) return universe;
  let nextDivision = division.map((f) => (
    f.id === oppEntry.id
      ? {
          ...f,
          record: { w: f.record.w + (result.win ? 0 : 1), l: f.record.l + (result.win ? 1 : 0) },
          recentForm: [result.win ? "L" : "W", ...(f.recentForm || [])].slice(0, 5),
        }
      : f
  ));
  if (!skipRankUpdate) {
    if (isTitleShot && result.win) {
      const exChampIdx = nextDivision.findIndex((f) => f.isChampion);
      nextDivision = nextDivision.map((f) => (f.isChampion ? { ...f, isChampion: false } : f));
      if (exChampIdx !== -1) nextDivision = demoteInDivision(nextDivision, exChampIdx, 3);
    } else if (isTitleDefense && !result.win) {
      nextDivision = nextDivision.map((f) => (f.id === oppEntry.id ? { ...f, isChampion: true } : f));
    } else if (isTitleDefense && result.win) {
      const challengerIdx = nextDivision.findIndex((f) => f.id === oppEntry.id);
      if (challengerIdx !== -1) nextDivision = demoteInDivision(nextDivision, challengerIdx, 6);
    }
  }
  return { ...universe, divisions: { ...universe.divisions, [tierBeforeKey]: nextDivision } };
}

// Runs exactly one world tick: all three persistent circuits advance once,
// unconditionally -- regardless of which tier (or Contender Series) the
// player's own fight happened in (section 4/5/32 of the underlying task).
// playerCircuitTier is tierBefore (the tier the fight ACTUALLY occurred
// in); playerHoldsBelt is whether the player held THAT tier's title
// immediately after this fight's own title logic resolved (so a same-fight
// title win correctly protects the tier the player just became champion
// of, and a same-fight promotion correctly leaves the tier just LEFT
// behind eligible for its own vacancy handling next tick).
function runWorldTick(universe, worldTick, playerCircuitTier, playerHoldsBelt, excludeOppId, year, weightClass) {
  const divisions = { ...universe.divisions };
  let rngState = universe.rngState;
  const allNewBouts = [];
  ["CLF Regional", "CLF National", "CLF PREMIER"].forEach((tierName) => {
    const key = circuitToUniverseKey(tierName);
    const division = divisions[key];
    if (!division) return; // defensive -- always exists post-Foundation-V1
    const excludeIds = (tierName === persistentTierForActiveRoster(playerCircuitTier) && excludeOppId) ? [excludeOppId] : [];
    const holdsBelt = tierName === playerCircuitTier && playerHoldsBelt;
    const recentPairings = recentPairingsForTier(universe.bouts, tierName, worldTick);
    const result = runWorldTickForDivision(division, tierName, holdsBelt, excludeIds, year, worldTick, rngState, recentPairings, weightClass);
    divisions[key] = result.division;
    rngState = result.nextRngState;
    allNewBouts.push(...result.bouts);
  });
  const { bouts: idBouts, nextBoutSeq } = assignBoutIds(allNewBouts, universe.boutSeq);
  const withBouts = {
    ...universe,
    divisions, rngState,
    worldTickSeq: worldTick,
    boutSeq: nextBoutSeq,
    bouts: [...(universe.bouts || []), ...idBouts],
  };
  // Universe Events V1: finalize this tick's card(s) only now that every
  // bout the tick will ever produce already exists in withBouts.bouts --
  // the player's own bout (appended by the caller BEFORE runWorldTick is
  // called; see commitFight) plus whichever of Regional/National/Premier
  // just generated background bouts above. See finalizeEventsForTick's
  // own comment for why this exact point, not any of the individual
  // per-tier steps above, is the only safe place to do this.
  return finalizeEventsForTick(withBouts, worldTick, year, weightClass);
}

// =========================================================================
//  UNIVERSE EVENTS V1
//  Turns the bout ledger World Movement + Bout Ledger V1 already produces
//  into actual persistent CLF event cards. CORE PRINCIPLE (see this
//  branch's own report): events ORGANIZE history, they do not resimulate
//  it. One bout still has exactly one result -- nothing in this section
//  resolves a fight, changes a record, or moves a ranking. It only reads
//  bouts that already exist and groups them.
// =========================================================================

// Bumped only if a future pass changes the event/title-transition SHAPE
// in a way old persisted data can't just fall back-default through (the
// same convention UNIVERSE_SCHEMA_VERSION already established). Doubles
// as migrateUniverseEvents' idempotency guard: a universe already at this
// version is treated as "already migrated," never re-backfilled.
const EVENT_SCHEMA_VERSION = 1;

function freshEventNumbers() {
  return { regional: 0, national: 0, premier: 0, contenderSeries: 0 };
}

// Per-circuit event-number COUNTER key -- deliberately its own small
// mapping, not a reuse of circuitToUniverseKey (which returns null for
// Contender Series, correct for ROSTER lookups but wrong here: CS has no
// persistent division, but it very much has its own event-number lineage
// once the player actually fights there -- see Section 6 of the
// underlying task).
function eventNumberKeyFor(circuit) {
  if (circuit === "CLF Regional") return "regional";
  if (circuit === "CLF National") return "national";
  if (circuit === "CLF PREMIER") return "premier";
  if (circuit === "CLF Contender Series") return "contenderSeries";
  return "regional"; // defensive, never expected on any real bout
}

// Deterministic card-order priority for one bout -- LOWER sorts first
// (headlines). No RNG. Title fight always headlines (Section 32); the
// player's own fight (if not itself the title fight) is naturally high on
// the card next; then ranked fights ordered by how good the best-ranked
// participant was going into it (a Champion-adjacent #2-vs-#4 outranks a
// #14-vs-#15 scrap); then fights with exactly one ranked side (boundary/
// prospect tests); everything else (unranked-pool bouts) fills the rest.
// Reads only rankABefore/rankBBefore -- already on every bout, no new
// per-bout tagging needed to reconstruct this later.
function cardPriorityScore(bout) {
  if (bout.titleFight) return 0;
  if (bout.fighterAId === PLAYER_BOUT_ID || bout.fighterBId === PLAYER_BOUT_ID) return 1;
  const rA = bout.rankABefore, rB = bout.rankBBefore;
  const bothRanked = rA != null && rB != null;
  const oneRanked = (rA != null) !== (rB != null);
  if (bothRanked) return 2 + Math.min(rA, rB) / 1000;
  if (oneRanked) return 3 + (rA ?? rB) / 1000;
  return 4;
}
// Stable sort (Array.prototype.sort is spec-guaranteed stable) by
// priority score; ties (rare -- would need identical rank inputs) resolve
// by original array position, which is itself already deterministic
// (bouts arrive here in the fixed title/vacancy -> ranked-ladder ->
// boundary -> unranked-pool generation order runWorldTickForDivision
// produces, or -- for the player's own bout -- always first in the tick
// per appendPlayerBout's ordering convention). Once computed for a given
// event, this order is persisted in boutIds and never recomputed later --
// see finalizeEventsForTick's own comment: card order is itself
// historical data, immune to any future ranking-logic change.
function orderBoutsForCard(bouts) {
  return [...bouts].sort((a, b) => cardPriorityScore(a) - cardPriorityScore(b));
}

// Groups ONE world tick's newly-appended bouts into one event per circuit
// that produced at least one bout this tick (Section 8: no empty cards).
// Called exactly once, from runWorldTick, AFTER every bout the tick will
// ever produce (the player's own bout, already appended by commitFight
// before calling runWorldTick, plus whatever Regional/National/Premier
// background activity just ran) already exists in universe.bouts -- see
// Section 3/7 of the underlying task: one event per circuit per world
// tick is the natural unit World Movement already produces, so this
// deliberately does NOT invent a second, independent event-scheduling
// system. A Contender Series event is created here too, but only when
// the player actually fought CS this tick (CS has no background
// division, so its "tick bouts" are always exactly the player's one
// showcase fight -- Section 6/11).
function finalizeEventsForTick(universe, worldTick, year, weightClass) {
  const tickBouts = (universe.bouts || []).filter((b) => b.worldTick === worldTick);
  if (!tickBouts.length) return universe;
  const byCircuit = new Map();
  tickBouts.forEach((b) => {
    if (!byCircuit.has(b.circuit)) byCircuit.set(b.circuit, []);
    byCircuit.get(b.circuit).push(b);
  });
  let eventSeq = universe.eventSeq || 0;
  const eventNumbers = { ...(universe.eventNumbers || freshEventNumbers()) };
  const newEvents = [];
  // Map iteration follows insertion order, which follows tickBouts' own
  // order (player bout's circuit first, since appendPlayerBout always
  // gives the player's bout the lowest id of the tick -- then Regional/
  // National/Premier in runWorldTick's own fixed iteration order) --
  // deterministic given the same input, every time.
  byCircuit.forEach((group, circuit) => {
    const key = eventNumberKeyFor(circuit);
    eventSeq += 1;
    eventNumbers[key] = (eventNumbers[key] || 0) + 1;
    newEvents.push({
      id: `event-${eventSeq}`, circuit,
      division: group[0].division ?? weightClass,
      year, worldTick,
      eventNumber: eventNumbers[key],
      boutIds: orderBoutsForCard(group).map((b) => b.id),
    });
  });
  return { ...universe, eventSeq, eventNumbers, events: [...(universe.events || []), ...newEvents] };
}

// Append-only historical fact for a title left behind WITHOUT a resolving
// fight (Section 33-38 of the underlying task) -- promotion, a Contender
// Series invite, a weight-class move, or retirement, all while the
// player was reigning champion of the tier being left. This is NOT a
// second source of championship truth: every title WIN/DEFENSE/LOSS
// still comes exclusively from a real ledger bout (championBeforeId on
// that bout), exactly as before. This only fills the one gap bouts alone
// cannot: proving a belt became vacant through the player's own choice
// to leave, rather than through a fight the ledger would otherwise show.
// Without this, a future Title Lineage reconstruction walking the bout
// ledger for a tier the player vacated this way can only ever say "the
// player held it as of the last bout, and by the next title/vacancy bout
// someone else does" -- never WHEN it actually became vacant or WHY.
function appendTitleTransition(universe, transition) {
  const titleTransitionSeq = (universe.titleTransitionSeq || 0) + 1;
  const entry = { id: `tt-${titleTransitionSeq}`, type: "vacated", championId: PLAYER_BOUT_ID, ...transition };
  return {
    ...universe,
    titleTransitionSeq,
    titleTransitions: [...(universe.titleTransitions || []), entry],
  };
}

// Captures the minimal, immutable identity (name/archetype) of every
// fighter in the given divisions -- called ONLY when a weight-class move
// is about to discard those divisions outright (see resolveWeightMoveOffer),
// so every fighter who only ever existed in the discarded old weight
// class stays resolvable forever afterward. Same shape/purpose as the
// opponentName/opponentArchetype fallback World Movement + Bout Ledger V1
// already uses for Contender Series opponents -- this is that same fix,
// applied at the scale of a whole discarded roster instead of one CS
// opponent.
function captureFighterIdentities(divisions) {
  const out = {};
  Object.values(divisions || {}).forEach((division) => {
    (division || []).forEach((f) => { out[f.id] = [f.name, f.archetype]; });
  });
  return out;
}

// One-time backfill for a #38-era active save: it has universe.bouts but
// no events/eventSeq/eventNumbers/titleTransitions/historicalFighterIdentities
// at all, and its existing bout records have no `division` (weight class)
// field. Idempotency guard is eventSchemaVersion itself -- a universe
// already at EVENT_SCHEMA_VERSION returns the SAME object reference
// unchanged (see normalizeUniverseState's own comment: callers rely on
// reference equality to detect "nothing to do"), so this is always safe
// to call on every load, never rebuilding events it already built.
//
// division backfill: safe to assign the Career's CURRENT weight class to
// every pre-existing bout, because a weight-class move in the #38 era
// discarded the ENTIRE prior universe outright (the exact bug this same
// branch's own report fixes in resolveWeightMoveOffer) -- any bout that
// survived to be migrated here is therefore guaranteed to have happened
// in this same weight class. Not a guess; a direct consequence of the
// bug being fixed in the same pass that adds the field being backfilled.
//
// Event grouping uses the IDENTICAL worldTick+circuit grouping and
// orderBoutsForCard priority function native event creation uses
// (Section 22) -- a migrated card and a natively-created card obey
// exactly the same rules, no separate migration-only logic to drift.
function migrateUniverseEvents(universe, currentDivision) {
  if (!universe) return universe;
  if ((universe.eventSchemaVersion || 0) >= EVENT_SCHEMA_VERSION) return universe;
  const bouts = (universe.bouts || []).map((b) => (b.division ? b : { ...b, division: currentDivision ?? null }));
  const byTickCircuit = new Map();
  bouts.forEach((b) => {
    const key = `${b.worldTick}::${b.circuit}`;
    if (!byTickCircuit.has(key)) byTickCircuit.set(key, []);
    byTickCircuit.get(key).push(b);
  });
  let eventSeq = 0;
  const eventNumbers = freshEventNumbers();
  const events = [];
  // Map iteration order follows insertion order, which follows `bouts`'
  // own array order -- already strictly non-decreasing by worldTick (the
  // ledger only ever appends), so ticks are visited chronologically
  // without needing an explicit sort here.
  byTickCircuit.forEach((group) => {
    const { circuit, worldTick, year, division } = group[0];
    const key = eventNumberKeyFor(circuit);
    eventSeq += 1;
    eventNumbers[key] = (eventNumbers[key] || 0) + 1;
    events.push({
      id: `event-${eventSeq}`, circuit, division, year, worldTick,
      eventNumber: eventNumbers[key],
      boutIds: orderBoutsForCard(group).map((b) => b.id),
    });
  });
  return {
    ...universe,
    bouts, eventSeq, events, eventNumbers,
    eventSchemaVersion: EVENT_SCHEMA_VERSION,
    // A #38-era save has no title-transition history to backfill (the
    // concept didn't exist yet) -- starts empty, same "truthful, not
    // fabricated" principle buildFreshUniverse's own bout ledger already
    // established. Preserves an already-migrated-partially value rather
    // than overwriting, though in practice this function only ever runs
    // once per universe (see the idempotency guard above).
    titleTransitionSeq: universe.titleTransitionSeq || 0,
    titleTransitions: universe.titleTransitions || [],
    historicalFighterIdentities: universe.historicalFighterIdentities || {},
  };
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
// Matchmaking Realism V1 shipped a flat REGIONAL_MATCHMAKING_CEILING (17)
// here, applied to every Regional fighter regardless of how their own
// career was actually going -- it fixed the "0 Regional title wins in
// 65,036 fights" problem (playerRank only moves on a ranked win, and the
// old uncapped formula at low rankPoints essentially never drew one before
// streak>=4 promoted the fighter out anyway) but the follow-up audit found
// a real cost: a flat ceiling pulls a fighter toward ranked opposition
// purely for having LOW rankPoints (i.e. being early/struggling), not for
// having demonstrated anything, so a genuinely weak build's Regional run
// got measurably harder across the board (win% 44%->30%) even on the
// fights it was already losing.
//
// V2 (below, regionalCompetitionCeiling) replaces the flat number with a
// small step function over DEMONSTRATED recent performance -- current win
// streak, and whether that streak already includes a real ranked win --
// never anything about the fighter's underlying attributes or draft
// quality, which this code has no access to anyway. A fighter who just
// lost, or hasn't strung wins together, gets Regional's original wide-open
// draw back (no ceiling at all, exactly pre-Realism-V1 behavior); a
// fighter on a real streak gets progressively tested; a fighter who has
// already beaten someone actually ranked while streaking gets the full
// ceiling this constant used to apply unconditionally. This is precisely
// "developmental / rising / contender" from the realism-v1-followup brief,
// intentionally not persisted as a stored label -- it's re-derived from
// state that already exists (streak, regionalEverBeatRanked) every time
// a fight is booked, so it can never drift out of sync with the fighter's
// actual current form.
const REGIONAL_RISING_STREAK = 2;
const REGIONAL_RISING_CEILING = 22;
const REGIONAL_CONTENDER_STREAK = 4;
const REGIONAL_CONTENDER_CEILING = 17;
function regionalCompetitionCeiling(streak, regionalEverBeatRanked) {
  const s = streak || 0;
  if (s < REGIONAL_RISING_STREAK) return null; // developmental -- no ceiling, Regional's original wide-open draw
  if (s >= REGIONAL_CONTENDER_STREAK && regionalEverBeatRanked) return REGIONAL_CONTENDER_CEILING;
  // Still building a case: proven momentum (streak>=2) but no ranked win
  // to show for it yet. A flat "rising" ceiling for the whole stretch
  // between here and either a ranked win or the streak>=7 dominance
  // override left a real gap -- a fighter who reaches streak 4-6 without
  // ever having been drawn a ranked opponent was stuck circling the same
  // soft pool (never qualifying for the tighter contender ceiling, since
  // that itself requires the ranked win this loop is waiting on) until the
  // override finally kicked in at 7. Tightening 2 points per fight past
  // the rising threshold, floored at the contender ceiling, means every
  // extra fight on an unrewarded streak gets a real, growing chance at a
  // ranked draw instead of an indefinite wait for the override.
  const tightened = REGIONAL_RISING_CEILING - 2 * (s - REGIONAL_RISING_STREAK);
  return Math.max(REGIONAL_CONTENDER_CEILING, tightened);
}
// Premier progression curve pass: Premier entry seeds rankPoints at 40
// (see resetForFreshTier), not 0 -- without a floor of its own, that
// seeds a natural centre deep in the unranked pool (~index 24),
// materially WEAKER than National's own capped draw (audit measured
// Premier-unranked opponents averaging ~56 OVR, actually below National's
// ~68). Same architectural pattern as National's ceiling above: caps how
// weak Premier's centre-of-the-draw can go, never how strong -- real
// momentum built at Premier still pulls the draw tougher once it's
// earned. 11 was chosen after prototyping 8/10/11/12: it lands ordinary
// ("default") Premier opponents around 68-72 OVR (matching National, no
// more difficulty drop) while leaving real room above for Top 15/Top 10/
// Top 5/champion, and keeps Easy/Ranked/Step-Up clearly differentiated.
const PREMIER_MATCHMAKING_CEILING = 11;

// Roster Ecology V1 -- candidate-pool helpers. Matchmaking Realism V1's
// own decision logic (regionalCompetitionCeiling, maybeFightChoice's
// deliberate rankedTest/eliminator/contenderTest checks, Step-Up's
// momentum gate) is completely untouched by any of this: those systems
// already decide WHAT LEVEL of fight a booking should be. This only helps
// selectDivisionOpponent decide WHICH UNRANKED FIGHTER fills an "easy" or
// ordinary "default" booking once that decision has already been made --
// reading straight off the ecology tag createEcologyFighter stamped at
// generation time, never inventing a new eligibility gate. Ranked/Step-Up
// candidates (pickRankedCandidate/pickStepUpCandidate) are untouched.
function eligibleEcologyPool(division, ecologyTags, avoid, extraFilter) {
  return division.filter((f) => f.ecology && ecologyTags.includes(f.ecology) && !avoid.includes(f.id) && (!extraFilter || extraFilter(f)));
}
function pickEcologyCandidate(division, ecologyTags, avoid, extraFilter) {
  const pool = eligibleEcologyPool(division, ecologyTags, avoid, extraFilter);
  if (!pool.length) return null;
  const fighter = pool[Math.floor(Math.random() * pool.length)];
  return { fighter, rank: displayRankFor(division, division.indexOf(fighter)) };
}
// "easy" ALSO always excludes any currently-hot fighter (see the
// extraFilter passed alongside this below), regardless of which ecology
// bucket they were generated into -- a VETERAN_GATEKEEPER can be a
// genuinely dangerous "prove you belong" test when they're on form, which
// is exactly wrong for a low-risk Stay Busy pick; the "cold veteran"
// section 15 asks for is a gatekeeper who currently ISN'T hot, not a
// gatekeeper who happens to carry that generation label regardless of
// form. First cut of this pass forgot that filter and measurably dragged
// LOW-cohort win% down (a real veteran-gatekeeper record averages a
// winning one) -- exactly the section 27 regression this branch is
// required not to repeat.
//
// Which ecology buckets make sense for THIS booking -- read from the exact
// same demonstrated-results signals Matchmaking Realism V1 already reads
// (streak, regionalEverBeatRanked, record), never the fighter's own hidden
// generation origin and never a new progression threshold (the constants
// referenced here -- REGIONAL_RISING_STREAK -- are Realism V1's own,
// completely unchanged). "easy" is deliberately narrow and never reaches
// into HOT_PROSPECT/RANKING_BUBBLE -- a struggling or fresh fighter picking
// their own low-risk fight should never land a dangerous undefeated
// prospect merely because both happen to be unranked (the LOW-cohort
// regression a prior pass already had to fix once).
function ecologyPoolFor(difficulty, streak, regionalEverBeatRanked, record) {
  if (difficulty === "easy") return ["DEVELOPMENTAL", "SOLID_UNRANKED", "VETERAN_GATEKEEPER"];
  const s = streak || 0;
  const rec = record || { w: 0, l: 0 };
  const strugglingOrFresh = rec.w + rec.l < 3 || rec.l > rec.w;
  if (strugglingOrFresh) return ["DEVELOPMENTAL", "SOLID_UNRANKED"];
  // Real momentum, no ranked scalp yet -- a serious-but-not-ranked test
  // (a "gatekeeper matchup"), the same rising window regionalCompetitionCeiling
  // already tightens toward.
  if (s >= REGIONAL_RISING_STREAK && !regionalEverBeatRanked) {
    return ["VETERAN_GATEKEEPER", "RANKING_BUBBLE", "HOT_PROSPECT"];
  }
  // General "prospect test" territory: a believable, varied pool.
  return ["HOT_PROSPECT", "RANKING_BUBBLE", "SOLID_UNRANKED", "VETERAN_GATEKEEPER"];
}

function selectDivisionOpponent(division, playerRankPoints, forTitle, avoidIds, difficulty, circuitTier, streak, regionalEverBeatRanked, record) {
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
  if (circuitTier === "CLF Regional") {
    const regionalCeiling = regionalCompetitionCeiling(streak, regionalEverBeatRanked);
    if (regionalCeiling != null) centre = Math.min(centre, regionalCeiling);
  } else if (circuitTier === "CLF National") centre = Math.min(centre, NATIONAL_MATCHMAKING_CEILING);
  else if (circuitTier === "CLF PREMIER") centre = Math.min(centre, PREMIER_MATCHMAKING_CEILING);
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
  // Roster Ecology V1: once the centre has landed beyond the ranked ladder
  // -- an ordinary "easy"/"default" booking that would have drawn an
  // unranked opponent anyway -- prefer a fighter from whichever ecology
  // bucket(s) actually fit this exact context over the old blind
  // centre+-3 jitter below. A believable unranked population is wasted if
  // selection still only ever samples whichever few fighters happen to
  // sit in a narrow index window around centre. Falls straight through to
  // the unchanged jitter approach if the ecology pool comes up empty for
  // any reason (avoid-list exhaustion, ranked/title picks, an edge case) --
  // this can only ever add a more contextual result, never a worse one.
  if ((difficulty === "easy" || difficulty === "default") && centre > DIVISION_SIZE) {
    const tags = ecologyPoolFor(difficulty, streak, regionalEverBeatRanked, record);
    // "easy" additionally excludes anyone currently hot, whatever bucket
    // they were generated into -- see ecologyPoolFor's own comment.
    const hotFilter = difficulty === "easy" ? (f) => !isHotContender(f) : null;
    // Difficulty-appropriate OVR window: reuses `centre` as a REFERENCE
    // toughness level, the same way the old monotonic-taper generation
    // implicitly capped how hard an unranked opponent could ever be
    // (baseRating 45-62 regardless of how tight the ceiling clamped
    // centre). Ecology buckets can run up to baseRating 76 -- exactly the
    // point, for a fighter who's actually earned that test -- but a fighter
    // who merely hit the same streak THRESHOLD on a much weaker run (a
    // LOW-cohort career can still string together 2-3 wins by chance)
    // must not draw the identical hot-prospect pool a genuinely dominant
    // run does just because Realism V1's ceiling clamp reads the same
    // streak number either way. Ecology still decides the FLAVOR of who
    // fills the booking; this keeps `centre` -- itself driven purely by
    // rankPoints/streak, never hidden attributes -- deciding how hard it
    // actually is. Widens by dropping the window (keeping ecology+hot
    // filters) before falling through to the full jitter approach, so an
    // empty windowed pool can never produce a worse result than before.
    const referenceOvr = clamp(Math.round(60 - (centre - DIVISION_SIZE) * 0.5), 45, 62);
    const ovrWindowed = (f) => Math.abs(f.overall - referenceOvr) <= 6;
    const windowedFilter = hotFilter ? (f) => hotFilter(f) && ovrWindowed(f) : ovrWindowed;
    let ecologyPicked = pickEcologyCandidate(division, tags, avoid, windowedFilter);
    if (!ecologyPicked) ecologyPicked = pickEcologyCandidate(division, tags, avoid, hotFilter);
    if (ecologyPicked) return ecologyPicked;
  }
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

// Normal contender-callout access (browsing the roster and picking anyone
// off it) is earned, not available from the start -- a Regional run, no
// matter how good, doesn't unlock it; Contender Series has no roster to
// browse at all. National only unlocks it once genuinely Top 15 there;
// Premier unlocks it outright (you're already in the show). Single source
// of truth for every UI entry point that gates on this, so the same rule
// can't drift between the callout list and any future surface that needs
// it.
function hasCalloutAccess(circuitTier, playerRank) {
  if (circuitTier === "CLF PREMIER") return true;
  if (circuitTier === "CLF National") return playerRank != null && playerRank <= DIVISION_SIZE;
  return false;
}

// All ranked (non-champion) division fighters within [loRank, hiRank]
// (inclusive), excluding anyone on the avoid-list. Reads displayRankFor
// per candidate rather than raw array index, so this stays correct
// whether or not the title is currently vacant.
function eligibleRankedInWindow(division, loRank, hiRank, avoid) {
  const out = [];
  division.forEach((f, idx) => {
    if (f.isChampion || avoid.includes(f.id)) return;
    const r = displayRankFor(division, idx);
    if (r != null && r >= loRank && r <= hiRank) out.push(f);
  });
  return out;
}

// RANKED FIGHT's window: examples worked through in the audit --
// unranked-nearing-Top-15 -> ~#11-15, #14 -> ~#10-15, #9 -> ~#5-10,
// #4 -> ~#1-5. All of those fit [rank-4, rank+1] clamped to the ladder,
// which is what this computes -- a tunable window, not hardcoded bands.
function rankedCandidateWindow(playerRank) {
  if (playerRank == null) return [DIVISION_SIZE - 4, DIVISION_SIZE];
  return [clamp(playerRank - 4, 1, DIVISION_SIZE), clamp(playerRank + 1, 1, DIVISION_SIZE)];
}

// RANKED FIGHT must always resolve to an actually ranked opponent (hard
// invariant) -- built from playerRank (the real ladder position), never
// rankPoints (the internal momentum value the old index-jitter draw used,
// which is exactly how an unranked fighter used to end up under this
// label). Widens the window once if nothing qualifies; returns null
// (truthful "no opponent" -- never substitutes an unranked fighter) only
// if even the full ladder is exhausted by the avoid-list.
function pickRankedCandidate(division, playerRank, avoid) {
  const [lo, hi] = rankedCandidateWindow(playerRank);
  let pool = eligibleRankedInWindow(division, lo, hi, avoid);
  if (!pool.length) pool = eligibleRankedInWindow(division, 1, DIVISION_SIZE, avoid);
  if (!pool.length) return null;
  const fighter = pool[Math.floor(Math.random() * pool.length)];
  return { fighter, rank: displayRankFor(division, division.indexOf(fighter)) };
}

// A candidate reads as "harder than Easy" if they're ranked and Easy
// isn't, or (both ranked / both unranked) they carry the stronger raw
// rating -- rank takes priority over overall when both are ranked, since
// a worse-rated #6 is still a bigger jump than a better-rated #9.
function isHarderThanEasy(fighter, division, easyFighter) {
  const fRank = displayRankFor(division, division.indexOf(fighter));
  const easyRank = displayRankFor(division, division.indexOf(easyFighter));
  if (fRank != null && easyRank == null) return true;
  if (fRank == null && easyRank != null) return false;
  if (fRank != null && easyRank != null) return fRank !== easyRank ? fRank < easyRank : fighter.overall > easyFighter.overall;
  return fighter.overall > easyFighter.overall;
}

// STEP-UP FIGHT's hard eligibility bar, all required: a real winning
// record and recent form (isHotContender covers "winning overall record"
// + "at least 3 wins in last 5" + "not on a 2+ fight losing streak" in
// one read), and meaningfully tougher than the Easy option already drawn
// for this same decision.
function passesStepUpHardCriteria(fighter, division, easyFighter) {
  return isHotContender(fighter) && isHarderThanEasy(fighter, division, easyFighter);
}

// STEP-UP FIGHT: a genuinely dangerous line-jump opportunity, never a
// bad-form fighter wearing a premium label. If the player is ranked, the
// candidate MUST be an actually-ranked fighter positioned above them --
// no unranked fallback once Top 15 (per the approved clarification). If
// the player is unranked, an unranked "hot prospect" can still qualify,
// but only with real momentum (a live win streak) on top of the base
// bar -- a ranked candidate (any rank) already clears that bar by being
// ranked at all. Selection among eligible candidates is simple ordered
// sorting, not a scored formula: ranked-above first, then better rank,
// then higher OVR, then longer streak, then more recent wins, then the
// most believable (closest) jump as the final tiebreak. Returns null
// (truthful "no opportunity") if nobody qualifies -- never fabricated.
// Maximum believable Step-Up jump: "you're #15, go fight #1" isn't a
// step-up, it's a lottery ticket. Capped at 5 places -- #15 -> #10-14,
// #10 -> #5-9, #5 -> #1-4. Reference position for the window is the
// player's real rank if they have one, else DIVISION_SIZE + 1 (the same
// "just below the ladder" virtual position used elsewhere for unranked
// tiebreaks), which lands an unranked player's window on #11-15 -- the
// bottom of the Top 15, not the top of it.
const STEP_UP_MAX_JUMP = 5;
// Realism pass, item 5/6: Step-Up used to be gated purely on the OPPONENT's
// form (isHotContender), which the audit found available ~97-98% of the
// time almost everywhere below Top 5 -- a "special, dangerous" opportunity
// that was actually on offer at nearly every booking isn't special. A real
// promotion doesn't hand a fighter a signature step-up fight for no reason
// -- it's offered BECAUSE that fighter has real momentum right now. Gating
// on the player's own current win streak (already-tracked state, no new
// field) ties the offer to the player's own context, not just whether some
// opponent happens to be in form -- simulated down to a healthy 20-45%-ish
// range per tier (see the realism-pass strategy/availability sim).
const STEP_UP_MOMENTUM_STREAK = 2;

function pickStepUpCandidate(division, playerRank, easyFighter, avoid, playerStreak) {
  if ((playerStreak || 0) < STEP_UP_MOMENTUM_STREAK) return null;
  const referencePos = playerRank != null ? playerRank : DIVISION_SIZE + 1;
  const windowLo = Math.max(1, referencePos - STEP_UP_MAX_JUMP);
  const windowHi = referencePos - 1;
  const candidates = [];
  division.forEach((f, idx) => {
    if (f.isChampion || avoid.includes(f.id) || f.id === easyFighter.id) return;
    if (!passesStepUpHardCriteria(f, division, easyFighter)) return;
    const rank = displayRankFor(division, idx);
    if (playerRank != null) {
      // Ranked player: must be ranked, above them, AND inside the
      // believable jump window -- never widen past this just to fill the
      // card; an empty window means "No Step-Up Available."
      if (rank == null || rank < windowLo || rank > windowHi) return;
    } else if (rank == null) {
      if (currentWinStreak(f) < 2) return; // unranked-vs-unranked needs a real live streak, not just a good record
    } else if (rank < windowLo || rank > windowHi) {
      return; // unranked-vs-ranked: only the bottom-of-ladder window (#11-15) is believable
    }
    candidates.push({ fighter: f, rank });
  });
  if (!candidates.length) return null;
  const target = referencePos;
  candidates.sort((a, b) => {
    const aRanked = a.rank != null ? 1 : 0;
    const bRanked = b.rank != null ? 1 : 0;
    if (aRanked !== bRanked) return bRanked - aRanked;
    if (a.rank != null && b.rank != null && a.rank !== b.rank) return a.rank - b.rank;
    if (a.fighter.overall !== b.fighter.overall) return b.fighter.overall - a.fighter.overall;
    const streakDiff = currentWinStreak(b.fighter) - currentWinStreak(a.fighter);
    if (streakDiff !== 0) return streakDiff;
    const winsDiff = recentWins(b.fighter) - recentWins(a.fighter);
    if (winsDiff !== 0) return winsDiff;
    const aDist = Math.abs((a.rank ?? DIVISION_SIZE + 1) - target);
    const bDist = Math.abs((b.rank ?? DIVISION_SIZE + 1) - target);
    return aDist - bDist;
  });
  return candidates[0];
}

// Realism pass, item 4/28/29: a small, explainable "why this fight" layer
// on top of the existing three tags -- the architecture (Easy/Ranked/
// Step-Up, plus their existing eligibility rules) stays exactly as-is; this
// only decides what the card SAYS about the candidate it already picked, so
// a real ranked opponent below the player reads as "Defend Your Rank" and
// one above reads as "Climb the Ladder," instead of every non-Easy fight
// wearing the same static label regardless of what it actually represents.
function describeMatchmakerOpportunity(tag, picked, playerRank) {
  const oppRank = picked.rank;
  const name = picked.fighter.name;
  if (tag === "easy") {
    if (oppRank != null && playerRank != null && oppRank > playerRank) {
      return { label: "Defend Your Rank", reason: `#${oppRank} wants your spot in the rankings.` };
    }
    if (isOnLosingSkid(picked.fighter, 2)) {
      return { label: "Stay Busy", reason: `${name} is cold right now -- a low-risk booking to stay active.` };
    }
    return { label: "Stay Busy", reason: "A straightforward booking to stay active." };
  }
  if (tag === "ranked") {
    if (oppRank != null && playerRank != null && oppRank < playerRank) {
      return { label: "Climb the Ladder", reason: `Beat #${oppRank} and move up the rankings.` };
    }
    if (oppRank != null && playerRank != null && oppRank > playerRank) {
      return { label: "Defend Your Rank", reason: `#${oppRank} is hunting your position.` };
    }
    if (playerRank == null && oppRank != null) {
      return { label: "Earn Your Ranking", reason: `Beat #${oppRank} and crack the Top 15.` };
    }
    return { label: "Ranked Climb", reason: "A real ranked opponent -- a genuine step up from Easy." };
  }
  // stepUp -- only ever offered at all once the player has real momentum
  // (see STEP_UP_MOMENTUM_STREAK), so every remaining label below is some
  // flavor of "cash in that momentum," not a routine menu option.
  if (playerRank != null && playerRank <= 5) {
    return { label: "Title Eliminator", reason: oppRank != null ? `Beat #${oppRank} and you're squarely in title contention.` : "A statement win to force the promotion's hand." };
  }
  if (playerRank == null) {
    return { label: "Prospect Test", reason: `${name} is unranked but red-hot -- a real early test of your run.` };
  }
  return { label: "Main Event Opportunity", reason: `${name} is on a run -- a rare shot to skip the line.` };
}

function matchmakerOptionFrom(tag, picked, playerRank) {
  const { label, reason } = describeMatchmakerOpportunity(tag, picked, playerRank);
  return {
    tag, available: true, fighterId: picked.fighter.id, rank: picked.rank,
    name: picked.fighter.name, archetype: picked.fighter.archetype,
    overall: picked.fighter.overall, record: picked.fighter.record,
    recentForm: picked.fighter.recentForm || [],
    label, reason,
  };
}

// Three matchmaking candidates for the panel -- Easy keeps its existing
// unconstrained centre-index draw (deliberately not tightened, per the
// audit); Ranked and Step-Up are now built from real eligibility (rank
// window / hard criteria) instead of an index-jitter draw, so their
// labels are never dishonest about who's actually being offered. A tag
// with no eligible candidate returns `available: false` instead of a
// substituted opponent -- the UI renders a truthful empty state for it.
// playerStreak (realism pass, item 5/6) gates Step-Up on the PLAYER's own
// current momentum, not just the opponent's -- see pickStepUpCandidate.
// regionalEverBeatRanked (realism-v1 follow-up) feeds the Regional
// competition-level step function -- see regionalCompetitionCeiling.
function generateMatchmakerOptions(division, playerRankPoints, playerRank, recentOpponentIds, circuitTier, playerStreak, regionalEverBeatRanked, record) {
  const avoid = [...(recentOpponentIds || [])];
  const pickedRecords = [];

  let easyPicked;
  for (let attempt = 0; attempt < 5; attempt++) {
    easyPicked = selectDivisionOpponent(division, playerRankPoints, false, avoid, "easy", circuitTier, playerStreak, regionalEverBeatRanked, record);
    const dupRecord = pickedRecords.some((r) => r.w === easyPicked.fighter.record.w && r.l === easyPicked.fighter.record.l);
    if (!dupRecord) break;
    avoid.push(easyPicked.fighter.id);
  }
  avoid.push(easyPicked.fighter.id);
  pickedRecords.push(easyPicked.fighter.record);

  const rankedPicked = pickRankedCandidate(division, playerRank, avoid);
  if (rankedPicked) avoid.push(rankedPicked.fighter.id);

  const stepUpPicked = pickStepUpCandidate(division, playerRank, easyPicked.fighter, avoid, playerStreak);
  if (stepUpPicked) avoid.push(stepUpPicked.fighter.id);

  return [
    matchmakerOptionFrom("easy", easyPicked, playerRank),
    rankedPicked ? matchmakerOptionFrom("ranked", rankedPicked, playerRank) : { tag: "ranked", available: false },
    stepUpPicked ? matchmakerOptionFrom("stepUp", stepUpPicked, playerRank) : { tag: "stepUp", available: false },
  ];
}

// A small, contextual Mic Time target pool -- never the full division.
// Ranked player: 1-4 spots above them (the believable line-jump zone),
// plus a hot nearby contender if one isn't already in that band. Unranked
// player: nearby prospects, plus a fringe-ranked target ONLY when this
// specific win's own context supports it (a real underdog scalp over a
// ranked opponent, or breaking into the Top 15 with this very fight).
// A real active rival is appended last, if one exists and isn't already
// in the pool. Capped at 3 candidates.
function generateMicTimeTargets(division, playerRank, rivals, avoid, fightEntry) {
  const pool = [];
  const push = (f) => { if (f && !f.isChampion && !avoid.includes(f.id) && !pool.some((p) => p.id === f.id)) pool.push(f); };

  if (playerRank != null) {
    const lo = clamp(playerRank - 4, 1, DIVISION_SIZE);
    const hi = clamp(playerRank - 1, 1, DIVISION_SIZE);
    if (hi >= lo) {
      const nearbyAbove = eligibleRankedInWindow(division, lo, hi, avoid)
        .sort((a, b) => currentWinStreak(b) - currentWinStreak(a) || recentWins(b) - recentWins(a));
      nearbyAbove.slice(0, 2).forEach(push);
      const hotNearby = eligibleRankedInWindow(division, clamp(lo - 2, 1, DIVISION_SIZE), hi, avoid).find(isHotContender);
      if (pool.length < 2) push(hotNearby);
    }
  } else {
    const contextSupportsRankedTarget = (fightEntry.rankAfter != null && fightEntry.rankAfter <= DIVISION_SIZE)
      || (fightEntry.oppRank != null && fightEntry.oppRank > 0);
    if (contextSupportsRankedTarget) {
      eligibleRankedInWindow(division, DIVISION_SIZE - 2, DIVISION_SIZE, avoid).slice(0, 1).forEach(push);
    }
    // Roster Ecology V1: the unranked slice is no longer laid out in
    // quality order by array index (see buildUnrankedEcology's shuffle),
    // so "the first few unranked slots" stopped meaning "the best few
    // unranked fighters" the moment that shuffle landed -- this used to
    // read idx <= DIVISION_SIZE+4 for exactly that reason. Prefer genuine
    // hot unranked contenders (the same real-record-plus-live-form bar
    // Step-Up already uses) from the WHOLE unranked pool instead.
    division.filter((f) => f.ecology && !avoid.includes(f.id) && isHotContender(f))
      .forEach((f) => { if (pool.length < 2) push(f); });
  }

  const activeRivals = (rivals || []).filter((r) => r.active && r.isRival);
  if (activeRivals.length) {
    const rivalFighter = division.find((f) => f.id === activeRivals[0].id);
    push(rivalFighter);
  }

  return pool.slice(0, 3).map((f) => ({
    fighterId: f.id, name: f.name, rank: displayRankFor(division, division.indexOf(f)),
    overall: f.overall, record: f.record, archetype: f.archetype,
  }));
}

// Career Matchmaking + Promotion Milestone pass, item 10: "Call Out a
// Contender" used to expose the entire ranked roster once hasCalloutAccess
// unlocked it -- truthful about WHO could be called out, but not about
// what a believable callout actually is. Same contextual-window principle
// generateMicTimeTargets above already established: a ranked player's
// pool is the believable line-jump zone directly above them (the same
// window shape as pickRankedCandidate/rankedCandidateWindow), plus a hot
// nearby contender if that window comes up short; an unranked player's
// pool is the bottom-of-the-ladder window only -- an unranked prospect
// calling out #1 isn't a real callout, it's a fantasy the game shouldn't
// offer as a real button. An active rival is appended last if one exists
// and isn't already in the pool. Capped at 6 -- enough to feel like a
// real, ownable choice (wider than Mic Time's post-fight 3, since this is
// a browsed list, not a forced prompt) without ever exposing the whole
// division. hasCalloutAccess itself (who gets to open this list at all)
// is untouched -- this only narrows what's inside it.
function generateCalloutTargets(division, playerRank, rivals, avoid) {
  const skip = avoid || [];
  const pool = [];
  const push = (f) => { if (f && !f.isChampion && !skip.includes(f.id) && !pool.some((p) => p.id === f.id)) pool.push(f); };

  if (playerRank != null) {
    const windowHi = clamp(playerRank - 1, 1, DIVISION_SIZE);
    const windowLo = clamp(playerRank - 4, 1, DIVISION_SIZE);
    if (windowHi >= windowLo) {
      eligibleRankedInWindow(division, windowLo, windowHi, skip)
        .sort((a, b) => currentWinStreak(b) - currentWinStreak(a) || recentWins(b) - recentWins(a))
        .forEach(push);
    }
    if (pool.length < 3) {
      const hotNearby = eligibleRankedInWindow(division, clamp(windowLo - 3, 1, DIVISION_SIZE), clamp(windowHi + 3, 1, DIVISION_SIZE), skip).find(isHotContender);
      push(hotNearby);
    }
  } else {
    eligibleRankedInWindow(division, DIVISION_SIZE - 4, DIVISION_SIZE, skip).forEach(push);
  }

  const activeRivals = (rivals || []).filter((r) => r.active && r.isRival);
  activeRivals.forEach((r) => push(division.find((f) => f.id === r.id)));

  return pool.slice(0, 6).map((f) => ({
    fighterId: f.id, name: f.name, rank: displayRankFor(division, division.indexOf(f)),
    overall: f.overall, record: f.record, archetype: f.archetype,
  }));
}

// Which fight results earn a Mic Time moment -- read straight off fields
// commitFight already computes for every fight, never re-derived. A plain
// finish and a win over any ranked opponent used to qualify on their own
// (release-playtest found this firing on ~75% of wins, ~95% of finishes --
// nowhere near "notable"). Tightened to genuinely meaningful results only:
// a performance bonus, a statement win, a live rivalry win, breaking into
// the Top 15 with this fight, a real upset, or beating someone actually
// ranked in the Top 5 (not just anywhere in the Top 15). Loss never
// qualifies. No cooldown/streak-suppression added yet -- this tighter set
// alone is the first pass.
function qualifiesForMicTime(e) {
  if (!e.win) return false;
  const enteredTop15 = e.rankAfter != null && e.rankAfter <= DIVISION_SIZE && (e.rankBefore == null || e.rankBefore > DIVISION_SIZE);
  const majorRankedWin = e.oppRank != null && e.oppRank > 0 && e.oppRank <= 5;
  return e.bonusType === "performance" || e.statement || e.rivalry || enteredTop15 || e.underdogWin || majorRankedWin;
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
// CHIN removed (Training Camp Rework V1, item 3) -- a "Chin Coach" doesn't
// make sense once Chin isn't a trainable specialty; matches TRAINABLE_KEYS.
const COACH_SPECIALTIES = ["STRIKING", "GRAPPLING", "WRESTLING", "CARDIO", "POWER", "SPEED", "IQ"];

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

// Acknowledges whatever live milestone commitFight set (circuitMove,
// titleWin, titleDefenseMilestone -- type-agnostic on purpose). Nothing to
// decide here -- the underlying truth (tier, title counters, timeline
// entries) already changed in commitFight -- this only clears the
// presentation flag so the next render falls through to whatever's
// actually next (a pendingDecision the same fight-commit may also have
// set, e.g. contract negotiation, or normal flow). A no-op past
// `!pendingMilestone` guards against a stray double-acknowledge.
function resolveMilestone(state) {
  if (!state.pendingMilestone) return state;
  return { ...state, pendingMilestone: null };
}

function initCareer(picks, options) {
  const base = {};
  SKILL_KEYS.forEach((k) => { base[k] = picks[k].scoreValue; });
  const totalYears = 8 + Math.floor(Math.random() * 4);
  // Universe Foundation V1: Regional/National/Premier all exist from the
  // moment a career starts. Regional (the active tier for a fresh career)
  // is generated via buildFreshUniverse's own default path -- the exact
  // same Math.random consumption a pre-Foundation-V1 initCareer already
  // had -- so National/Premier now also existing changes nothing about
  // this career's own subsequent randomness. The universe seed itself is
  // deliberately NOT read from Math.random (that would still be one extra
  // player-stream call) -- `options.universeSeed` lets tests/tools supply
  // a specific seed; production falls back to Date.now(), consuming zero
  // player-facing random calls either way.
  const universe = buildFreshUniverse("CLF Regional", (options && options.universeSeed) ?? Date.now());
  return {
    base,
    // Immutable Career-start snapshot (Training Camp Rework V1) -- the
    // ONLY source for "current vs drafted" comparisons (see the Stats
    // tab's Current Fighter view). Never mutated after this; current
    // permanent development is always just base - draftBase, never
    // tracked as a separate running total.
    draftBase: { ...base },
    reachScore: picks.REACH.scoreValue,
    // HEIGHT never feeds combat (only REACH does, via reachScore above)
    // and never changes after the draft -- captured once here purely so
    // the Current Fighter view has a real number to show alongside REACH,
    // not a second calculation.
    heightScore: picks.HEIGHT.scoreValue,
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
    // fight each other between your bouts. divisionRoster is a synchronized
    // alias for whichever universe division is currently ACTIVE (see
    // syncActiveDivision/getActiveDivision) -- universe.divisions is the
    // authoritative store.
    divisionRoster: universe.divisions.regional,
    universe,
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
    // Tier-scoped breakdown of the flat counters above -- see TITLE_TIERS.
    // The flat titleReigns/titleDefenses stay authoritative for every
    // reader that doesn't need the breakdown (achievements, share-card
    // text); these are additive, not a replacement.
    titleReignsByTier: freshTitleTierCounts(), titleDefensesByTier: freshTitleTierCounts(),
    streak: 0, longestStreak: 0,
    // Repeat-title-shot lock (see commitFight) -- false by default, same
    // as every other career-long flag.
    specialTitleShotLockedUntilWin: false,
    // Premier natural-title-chase beat (see naturalTitleShotReady) --
    // false by default; set by a win recorded while already Top 5 at
    // Premier, cleared by any loss.
    provenAtTop5: false,
    // Scoped to CLF National fights only (see the National->Contender
    // Series gate in commitFight) -- never touched by Regional or Premier
    // fights, and never reset by a Contender Series loss bouncing back to
    // National (that's "standing intact," same as everything else at this
    // tier). nationalLosses exists purely to require a winning National
    // record at the gate -- a fighter who's losing more than they're
    // winning shouldn't earn the same invite as one who isn't, no matter
    // how good the wins they do have were.
    nationalWins: 0, nationalLosses: 0, nationalOppQualitySum: 0,
    // Realism-v1 follow-up: has this Regional run ever beaten an actually-
    // ranked Regional opponent -- a permanent resume fact for this
    // Regional stint, NOT reset by a later losing skid (an earlier
    // version scoped this to the current win streak only, which meant an
    // otherwise-dominant run that took one early loss anywhere lost credit
    // for a ranked win it had already earned, and measurably cost ELITE/
    // GOAT-tier fighters Regional time -- see commitFight's fast-track
    // gate and regionalCompetitionCeiling). Missing entirely on an old
    // save reads as falsy (`|| false` / truthiness checks everywhere it's
    // used), same convention as every other compatibility-sensitive field
    // here. Reset back to false only where a fresh Regional stint actually
    // starts (a brand-new career, or a weight-class move -- see
    // resolveWeightMoveOffer).
    regionalEverBeatRanked: false,
    wear: { chin: 0, speed: 0 }, weightPenaltyFightsLeft: 0,
    runningLegacy: 0, oppQualitySumWins: 0, statementWins: 0, rivalryWins: 0,
    rivals: [], recentOpponentIds: [], definingLoss: null,
    // Training Camp Rework V1: campFocus is this year's chosen Camp focus
    // id (see CAMP_FOCUSES) or null; fightStance is the CURRENT pending
    // fight's gameplan choice (see setFightStance), reset to neutral every
    // new fight rather than carried year-long -- the annual/per-fight
    // split is intentional (item 18). lastCampResult is the most recent
    // camp's result only (see resolveCampPlanning) -- no Camp history.
    campFocus: null, fightStance: "balanced", campQuality: "full", mediaBuff: null,
    lastCampResult: null,
    // Fight Result + Retirement cleanup, item 12: first-time-only rank
    // achievement tracking (Top 5 / #1 contender) -- see commitFight. Never
    // reset once true, so bouncing back out of and into the same threshold
    // later in the career never re-fires it.
    everReachedTop5: false, everReachedNumberOne: false,
    // Career Presentation recovery pass, item 6: one-shot flag consumed by
    // maybeFightChoice's very next roll -- see there and commitFight.
    suppressNextFlavorEvent: false,
    wonTitleAsUnderdog: false,
    // Phase 4 (Career Arc): a coach relationship that deepens over camps,
    // fame built through off-cycle content (feeds sponsor money), a real
    // purse, and the contract that decides how it gets paid out.
    coach: null,
    fame: 0,
    purse: 0,
    contract: DEFAULT_CONTRACT,
    contractNegotiated: false,
    // Duplicate timeline ID hotfix: trainingEvent/mediaEvent/offCycleEvent
    // are the only timeline entries that can recur several times within the
    // same year without fightGlobalIndex advancing (see
    // nextTimelineEventSeq's own comment, right above resolveTrainingEvent,
    // for why). One small dedicated counter, bumped once per such event
    // regardless of which of the three it is, folded into each id as a
    // trailing suffix -- see nextTimelineEventSeq. Missing entirely on an
    // old save reads as 0 (`|| 0`), same compatibility convention as
    // regionalEverBeatRanked above: no migration, no rewritten history.
    timelineEventSeq: 0,
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
    // "This happened, acknowledge it" -- deliberately separate from
    // pendingDecision ("what do you choose"), so a circuitMove promotion
    // and a same-fight pendingDecision (contract negotiation on the
    // Contender Series win, chiefly) never compete for the same slot. Set
    // only in commitFight, alongside the circuitMove timeline entry it
    // presents; cleared by resolveMilestone. Missing on an old save
    // behaves exactly like null (never inferred/retroactively promoted).
    pendingMilestone: null,
    finished: false, legacyScore: 0, verdict: null, totalFightCount: 0,
  };
}

// =========================================================================
//  TRAINING CAMP REWORK V1
// =========================================================================
// CHIN, HEIGHT and REACH are deliberately absent from every trainable set
// below -- Chin is physiological durability (see applyAging's wear-based
// decline, untouched by this pass), Height/Reach are fixed physical
// measurements. Every Camp focus writes PERMANENTLY to s.base -- this
// replaces the old temporary +4/-1/-1 "effective"-only boost (see the
// removed yearFocusAttr block that used to live in prepareFight), which
// reset every year with nothing to show for it. s.base stays the ONLY
// authoritative permanent attribute store; there is no shadow copy, so a
// Camp gain is automatically what applyAging, fight simulation, matchup
// preview, archetype detection, traits, narrative, and the retirement
// snapshot all see -- same guarantee every other s.base writer already had.
const TRAINABLE_KEYS = ["STRIKING", "GRAPPLING", "WRESTLING", "CARDIO", "POWER", "SPEED", "IQ"];

// Five MMA-authentic Camp focuses, each a primary (real development) +
// small secondary (deterministic from the focus, never random) -- replaces
// the old raw 8-button attribute picker. Conditioning is the one with no
// stat secondary; its "secondary" is a recovery benefit (see
// resolveCampPlanning) using the existing wear model instead.
const CAMP_FOCUSES = {
  striking: { label: "Striking Camp", primary: "STRIKING", secondary: "SPEED" },
  wrestling: { label: "Wrestling Camp", primary: "WRESTLING", secondary: "CARDIO" },
  grappling: { label: "Grappling Camp", primary: "GRAPPLING", secondary: "IQ" },
  conditioning: { label: "Conditioning Camp", primary: "CARDIO", secondary: null, recovery: true },
  power: { label: "Power & Mechanics", primary: "POWER", secondary: "STRIKING" },
};
// Fast-forward default (see fastForwardCareer): which focus best addresses
// a given weakest-trainable attribute. IQ/SPEED are never a focus's PRIMARY
// in the locked V1 set, only secondaries -- fall back to whichever focus's
// secondary reaches them, so fast-forward still gives real attention
// instead of skipping a focus IQ/SPEED happen to be weakest in.
const CAMP_FOCUS_BY_PRIMARY = { STRIKING: "striking", WRESTLING: "wrestling", GRAPPLING: "grappling", CARDIO: "conditioning", POWER: "power" };
const CAMP_FOCUS_BY_SECONDARY_FALLBACK = { SPEED: "striking", IQ: "grappling" };
function focusForWeakestTrainable(base) {
  const weakest = TRAINABLE_KEYS.slice().sort((a, b) => base[a] - base[b])[0];
  return CAMP_FOCUS_BY_PRIMARY[weakest] || CAMP_FOCUS_BY_SECONDARY_FALLBACK[weakest] || "striking";
}

// Diminishing returns: the SAME small permanent gain lands very differently
// on a 60-rated attribute than a 90-rated one -- today it didn't (a flat
// gain regardless of rating), which is what let a fighter grind a stat as
// easily at 90 as at 60. Piecewise-linear between the approved anchor
// points, flat outside that range -- a lookup a player could sanity-check
// by eye, not a hidden XP curve.
const CAMP_DR_POINTS = [[60, 1.00], [70, 0.70], [80, 0.45], [90, 0.15]];
function campDrMultiplier(rating) {
  if (rating <= CAMP_DR_POINTS[0][0]) return CAMP_DR_POINTS[0][1];
  const last = CAMP_DR_POINTS[CAMP_DR_POINTS.length - 1];
  if (rating >= last[0]) return last[1];
  for (let i = 0; i < CAMP_DR_POINTS.length - 1; i++) {
    const [x0, y0] = CAMP_DR_POINTS[i], [x1, y1] = CAMP_DR_POINTS[i + 1];
    if (rating >= x0 && rating <= x1) return y0 + (y1 - y0) * ((rating - x0) / (x1 - x0));
  }
  return last[1];
}

// Career-stage taper: development slows as a career matures (years 1-4
// full, 5-7 reduced, 8+ maintenance-only) -- completely separate from, and
// does not alter, applyAging's own decline curve. This only scales how
// much Camp/Training Event can ADD; aging's own math is untouched.
function campStageMultiplier(year) {
  if (year <= 4) return 1.0;
  if (year <= 7) return 0.55;
  return 0.2;
}

const CAMP_PRIMARY_BASE_GAIN = 1.6;
const CAMP_SECONDARY_FRACTION = 0.32; // ~25-40% of the primary, per spec
const CAMP_RECOVERY_AMOUNT = 2; // wear.chin/wear.speed reduced by this much on a Conditioning Camp
// Training Event's "Address It" stays a smaller, rarer contextual bonus,
// not a second full development system -- same diminishing-returns curve
// as Camp, deliberately smaller base target.
const TRAINING_EVENT_BASE_GAIN = 1.0;

// The EXACT formula resolveCampPlanning applies a moment later -- called
// from there AND from the pre-confirm preview (App.jsx), so what the player
// sees before "Begin Camp" can never be a second, possibly-drifted
// estimate. Returns null for an unknown/no focus.
function previewCampFocus(base, year, coach, focus) {
  const def = CAMP_FOCUSES[focus];
  if (!def) return null;
  const stage = campStageMultiplier(year);
  const coachBonus = (coach && coach.specialty === def.primary) ? coach.level * 0.3 : 0;
  const primaryGain = (CAMP_PRIMARY_BASE_GAIN + coachBonus) * campDrMultiplier(base[def.primary]) * stage;
  const secondaryGain = def.secondary ? CAMP_PRIMARY_BASE_GAIN * CAMP_SECONDARY_FRACTION * campDrMultiplier(base[def.secondary]) * stage : 0;
  return { primaryAttr: def.primary, primaryGain, secondaryAttr: def.secondary, secondaryGain, recovery: !!def.recovery };
}

function resolveCampPlanning(state, { focus, campQuality }) {
  const s = { ...state };
  s.campFocus = focus || null;
  s.campQuality = campQuality;
  // Snapshot rank/title status right as the year begins, so the year-end
  // recap can show what changed over the course of the year.
  s.yearStartRank = state.playerRank;
  s.yearStartChampion = state.champion;
  s.yearStartTier = state.circuitTier;
  s.yearStartLegacy = state.runningLegacy;

  // ---- Permanent development (Training Camp Rework V1) --------------
  // Applied here, before the injury roll below reads s.base/s.wear, so a
  // Conditioning Camp's recovery this same year genuinely lowers this
  // year's injury risk -- one source of truth, no separate bookkeeping.
  let lastCampResult = null;
  if (focus && CAMP_FOCUSES[focus]) {
    const def = CAMP_FOCUSES[focus];
    const preview = previewCampFocus(s.base, s.year, state.coach, focus);
    const primaryBefore = s.base[def.primary];
    const primaryAfter = clamp(primaryBefore + preview.primaryGain, 30, 99);
    s.base = { ...s.base, [def.primary]: primaryAfter };

    let secondaryAttr = null, secondaryBefore = null, secondaryAfter = null;
    if (def.secondary) {
      secondaryAttr = def.secondary;
      secondaryBefore = s.base[secondaryAttr];
      secondaryAfter = clamp(secondaryBefore + preview.secondaryGain, 30, 99);
      s.base = { ...s.base, [secondaryAttr]: secondaryAfter };
    }

    let wearRecovered = null;
    if (def.recovery) {
      const chinBefore = s.wear.chin, speedBefore = s.wear.speed;
      s.wear = { chin: Math.max(0, s.wear.chin - CAMP_RECOVERY_AMOUNT), speed: Math.max(0, s.wear.speed - CAMP_RECOVERY_AMOUNT) };
      if (s.wear.chin !== chinBefore || s.wear.speed !== speedBefore) {
        wearRecovered = { chinBefore, chinAfter: s.wear.chin, speedBefore, speedAfter: s.wear.speed };
      }
    }

    lastCampResult = { focus, primaryAttr: def.primary, primaryBefore, primaryAfter, secondaryAttr, secondaryBefore, secondaryAfter, wearRecovered };
  }
  s.lastCampResult = lastCampResult;

  const effective = applyAging(s.base, s.year, s.wear);
  const riskMult = campQuality === "full" ? 0.55 : 1.35;
  const injury = rollInjury(effective, riskMult);
  let fightsThisYear = 2 + Math.floor(Math.random() * 3);
  if (s.year > 8) fightsThisYear = Math.max(1, fightsThisYear - 1);
  if (campQuality === "full") fightsThisYear = Math.max(1, fightsThisYear - 1);

  // circuitTier/champion ride along too -- the "made the leap" read in the
  // UI needs to know whether a tier was already broken into, not just the
  // raw playerRank number, since that resets to null on every promotion.
  const timeline = [...s.timeline, { type: "campPlan", id: `plan-${s.year}`, year: s.year, focus, campQuality, rankSnapshot: state.playerRank, circuitTier: state.circuitTier, champion: state.champion }];
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
          syncActiveDivision(s, s.divisionRoster.map((f, i) => (i === 0 ? { ...f, isChampion: true } : f)));
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
    const focusPrimary = focus && CAMP_FOCUSES[focus] ? CAMP_FOCUSES[focus].primary : null;
    const focusMatch = focusPrimary === s.coach.specialty;
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
    // Universe Foundation V1: a weight-class move is the one case that
    // genuinely needs a FRESH universe, not a lookup -- there is no
    // existing National/Premier for a weight class the player has never
    // been in. Matches current product behavior at larger scope (the old
    // single-division rebuild already discarded everything on a weight
    // move; this discards the whole 3-tier universe the same way). Seeded
    // from the outgoing universe's own rngState rather than Math.random --
    // that's still an unpredictable-looking 32-bit value, and reusing it
    // costs zero extra player-facing random calls. Falls back to
    // Date.now() only if no universe exists yet (an old, unmigrated save).
    //
    // The outgoing universe's fighterSeq is threaded through as the new
    // universe's STARTING sequence (never restarted at 0) -- ids are a
    // career/universe-wide contract (fighter-1, fighter-2, ... never
    // reused), so even though this whole old universe is discarded in V1,
    // its ids must never be handed out again to a different fighter: a
    // future pass (fighter histories, event archives, title lineage) will
    // want every id ever issued in this career to stay uniquely
    // attributable. Falls back to 0 only alongside the Date.now() case
    // above (no prior universe to continue from at all).
    //
    // s.circuitTier is routed through persistentTierForActiveRoster before
    // both calls below: a weight-move offer can in principle be rolled
    // while mid-Contender-Series (the 5% roll in resolveCampPlanning does
    // not check circuitTier), and CS itself has no persistent division to
    // hand back into buildFreshUniverse or index into divisions with --
    // National is the real tier this roster belongs to in that case (see
    // persistentTierForActiveRoster's own comment).
    const activeTier = persistentTierForActiveRoster(s.circuitTier);
    const outgoingUniverse = s.universe;
    s.universe = buildFreshUniverse(
      activeTier,
      outgoingUniverse ? outgoingUniverse.rngState : Date.now(),
      outgoingUniverse ? outgoingUniverse.fighterSeq : 0
    );
    // Universe Events V1, Section 25-27: a weight-class move genuinely
    // needs fresh LIVE divisions (buildFreshUniverse above, unchanged) --
    // there is no existing National/Premier roster for a weight class the
    // player has never been in. But the outgoing universe's HISTORY is a
    // different thing entirely from its rosters, and discarding it here
    // (as this pass originally did, before this fix -- confirmed by
    // direct reproduction, see this branch's own report) would silently
    // erase every bout/event/title-transition fact from a Career the
    // player already lived, the exact "Career changes weight class and
    // its own fight history disappears" bug this pass exists to close.
    // The old divisions themselves do NOT need to keep simulating after
    // the move (matches existing product behavior -- the old weight
    // class's world simply stops advancing once the player leaves it,
    // same as before this fix); only their HISTORY and every fighter
    // identity needed to keep that history resolvable survive.
    if (outgoingUniverse) {
      s.universe = {
        ...s.universe,
        bouts: outgoingUniverse.bouts || [],
        boutSeq: outgoingUniverse.boutSeq || 0,
        worldTickSeq: outgoingUniverse.worldTickSeq || 0,
        eventSeq: outgoingUniverse.eventSeq || 0,
        events: outgoingUniverse.events || [],
        eventNumbers: outgoingUniverse.eventNumbers || freshEventNumbers(),
        eventSchemaVersion: outgoingUniverse.eventSchemaVersion || EVENT_SCHEMA_VERSION,
        titleTransitionSeq: outgoingUniverse.titleTransitionSeq || 0,
        titleTransitions: outgoingUniverse.titleTransitions || [],
        // Every fighter who only ever existed in the now-discarded old
        // divisions gets a permanent identity snapshot here, merged with
        // any already captured by an EARLIER weight move in this same
        // Career -- so a bout/event from weight class #1 stays resolvable
        // even after a Career has since moved through weight classes #2
        // and #3. Global fighter ids never collide across this (fighterSeq
        // above is threaded through, never restarted), so a plain merge
        // is safe.
        historicalFighterIdentities: {
          ...(outgoingUniverse.historicalFighterIdentities || {}),
          ...captureFighterIdentities(outgoingUniverse.divisions),
        },
      };
      // The player's OWN belt, if they were holding one going into this
      // move, is left behind without a resolving fight -- record it
      // (Section 33-38) before champion/playerRank are cleared below.
      if (state.champion) {
        s.universe = appendTitleTransition(s.universe, {
          circuit: state.circuitTier, division: state.division,
          worldTick: s.universe.worldTickSeq, year: s.year, reason: "weightMove",
        });
      }
    }
    s.divisionRoster = s.universe.divisions[circuitToUniverseKey(activeTier) || "regional"];
    s.playerRank = null;
    s.rankPoints = 0;
    s.champion = false;
    s.weightPenaltyFightsLeft = 2;
    // A brand-new division's Top 15 -- any ranked win recorded against the
    // OLD one shouldn't still count as resume evidence in this one (see
    // regionalEverBeatRanked). Moot outside Regional (nothing reads this
    // flag past that tier), harmless to always reset.
    s.regionalEverBeatRanked = false;
    s.timeline = [...s.timeline, { type: "weightMove", id: `wm-${s.year}-${s.fightGlobalIndex}`, direction, division: s.division }];
  } else {
    s.timeline = [...s.timeline, { type: "weightMoveDeclined", id: `wmd-${s.year}-${s.fightGlobalIndex}`, division: s.division }];
  }
  s.pendingDecision = null;
  return s;
}

// Promotion agency pass: mirrors resolveWeightMoveOffer's own "earn it, the
// player decides, applying it is a separate step from earning it" shape.
// Regional->National is the only transition this covers -- National-
// >Contender Series is already framed as an invite the player earns by
// winning National's title (own copy/CTA, see MILESTONE_COPY), and
// Contender Series's own win/loss outcome is a direct, single-fight
// consequence, not a standing offer -- neither reads as "already decided
// for you" the way the old unconditional Regional->National flip did.
//
// Accepting applies EXACTLY the transition that used to happen
// automatically (circuitTier, division sync, playerRank/champion/
// rankPoints/streak reset, peak-tier tracking, specialTitleShotLockedUntilWin
// reset) -- just evaluated against the CURRENT state at accept time rather
// than mid-fight. That is a deliberate improvement, not an oversight: a
// player who wins the Regional belt and declines the National call is
// still the Regional champion (they haven't left), so the belt is only
// recorded as vacated (appendTitleTransition) if `state.champion` is still
// true at the moment of ACCEPTING -- same idiom resolveWeightMoveOffer
// already uses for its own left-behind-belt case, just triggered later.
//
// Declining costs nothing mechanically and is not the exploit it might
// look like: nothing about staying in Regional inflates National's
// eventual starting position (rank/rankPoints/streak all still reset to
// zero on whatever later fight the player does accept), so there is no
// reward for delaying beyond the ones any real fighter has for defending
// a belt before moving up -- more Regional bookings, more Regional-level
// competition, not a discount on National. commitFight suppresses
// re-offering on every subsequent win once already declined once (see
// promotionOfferDeclined there) and re-arms it on the next Regional loss.
function resolvePromotionOffer(state, accept) {
  const s = { ...state };
  const { tier } = state.pendingDecision;
  if (accept) {
    const tierBefore = s.circuitTier;
    s.circuitTier = tier;
    const destinationDivision = s.universe
      ? getDivisionForTier(s, s.circuitTier)
      : buildDivision(s.circuitTier);
    syncActiveDivision(s, destinationDivision || buildDivision(s.circuitTier));
    if (state.champion) {
      s.universe = appendTitleTransition(s.universe, {
        circuit: tierBefore, division: state.division,
        worldTick: s.universe.worldTickSeq, year: s.year, reason: "promotion",
      });
    }
    s.playerRank = null;
    s.champion = false;
    s.rankPoints = 0;
    s.streak = 0;
    s.specialTitleShotLockedUntilWin = false;
    s.promotionOfferDeclined = false;
    if (CLF_TIER_ORDER.indexOf(s.circuitTier) > CLF_TIER_ORDER.indexOf(s.peakCircuitTier)) {
      s.peakCircuitTier = s.circuitTier;
    }
    // Reuses the existing circuitMove timeline type/rendering -- this IS a
    // circuit promotion, just decided later than the fight that earned it,
    // so it gets the exact same "SIGNED — MOVING UP" Career History card
    // any other circuitMove already produces, no new UI needed for accept.
    s.timeline = [...s.timeline, { type: "circuitMove", id: `circuit-promo-${s.year}-${s.fightGlobalIndex}`, promoted: true, from: tierBefore, to: tier }];
  } else {
    s.promotionOfferDeclined = true;
    s.timeline = [...s.timeline, { type: "promotionDeclined", id: `promod-${s.year}-${s.fightGlobalIndex}`, tier }];
  }
  s.pendingDecision = null;
  return s;
}

// Matchmaking Realism V1 finalization: deliberately decide WHAT LEVEL of
// fight a Regional/National fighter has EARNED, from demonstrated results
// already tracked in state (streak, regionalEverBeatRanked, nationalWins/
// nationalLosses, playerRank) -- never from the fighter's underlying
// attributes, archetype, or anything else this code has no business
// reading. The existing pickers (pickRankedCandidate, completely
// unchanged) still supply WHICH fighter fills the booking -- randomness
// stays inside the eligible pool, it just stops deciding WHETHER an
// obviously-earned test happens at all. Before this, a hot streak's actual
// ranked test depended on the 22%-roll fightChoice menu firing AND then
// either the player or the simulated policy happening to pick Ranked --
// realistic in principle, but it meant a genuinely dominant prospect could
// just as easily keep drawing ordinary fights for several bookings in a
// row, which is exactly the "advancing slower not because they're losing,
// but because the promotion never got around to testing them" problem
// this pass targets. Scoped as tightly as possible: only fires for a
// fighter who has NOT yet earned a natural title shot (checked first, in
// maybeFightChoice, same precedent as the existing champion/title bypass)
// and who clears one of the gates below (tested head-to-head against a
// simpler flat-streak-only gate during this pass; this one -- streak OR
// streak+win% -- produced a real, if still modest, lift in Regional title
// wins and GOAT-tier championship recovery for no measurable cost
// elsewhere, so it's the one that stayed).
const REGIONAL_RANKED_TEST_STREAK = 4;
const REGIONAL_RANKED_TEST_HOT_STREAK = 2;
const REGIONAL_RANKED_TEST_HOT_WINPCT = 0.7;
const REGIONAL_RANKED_TEST_HOT_MIN_FIGHTS = 3;
const REGIONAL_ELIMINATOR_STREAK = 2;
// Model B: not just "3 in a row" -- a clean, quality record can earn the
// test a fight sooner (streak 2 at 70%+ over at least 3 fights), while a
// scrappier one that only just got to a plain streak needs one more win
// (4) before the promotion decides it's worth the deliberate test. Same
// evidence bar the fast-track gate itself already uses (regionalEverBeatRanked),
// just read a fight earlier via win% instead of waiting on streak alone.
function regionalRankedTestDue(state) {
  if (state.regionalEverBeatRanked) return false;
  const streak = state.streak || 0;
  const record = state.record || { w: 0, l: 0 };
  const totalFights = record.w + record.l;
  const winPct = totalFights > 0 ? record.w / totalFights : 0;
  if (streak >= REGIONAL_RANKED_TEST_HOT_STREAK && totalFights >= REGIONAL_RANKED_TEST_HOT_MIN_FIGHTS
    && winPct >= REGIONAL_RANKED_TEST_HOT_WINPCT) return true;
  return streak >= REGIONAL_RANKED_TEST_STREAK;
}
function regionalOpportunityFor(state) {
  if (state.circuitTier !== "CLF Regional") return null;
  // A real win streak with no ranked scalp yet -- "let's see if this
  // prospect belongs." Mirrors the exact evidence the Regional fast-track
  // gate itself already requires (see regionalEverBeatRanked's own
  // comment in initCareer/commitFight) -- this just stops waiting for
  // random chance to supply the opponent that evidence needs.
  if (regionalRankedTestDue(state)) return "rankedTest";
  // Already proven against real competition, still winning, but not yet
  // ranked high enough for the natural title-shot gate to fire on its
  // own -- push them toward it deliberately instead of leaving the climb
  // to whatever the next random draw happens to be.
  if (state.regionalEverBeatRanked && (state.streak || 0) >= REGIONAL_ELIMINATOR_STREAK
    && state.playerRank != null && state.playerRank > REGIONAL_TITLE_RANK_THRESHOLD) return "eliminator";
  return null;
}
// National's own matchmaking ceiling (10) already keeps its DEFAULT draw
// close to the ranked pool, unlike Regional's pre-fix problem -- so this is
// deliberately the "lighter touch" the brief asks for: one threshold, not
// two, and it only nudges a fighter who has already cleared National's own
// existing fast-track quality bar (nationalWins/nationalLosses/quality)
// toward a deliberate ranked fight instead of the next random draw, rather
// than inventing a second, parallel National progression ladder.
const NATIONAL_CONTENDER_STREAK = 2;
function nationalOpportunityFor(state) {
  if (state.circuitTier !== "CLF National") return null;
  if ((state.streak || 0) >= NATIONAL_CONTENDER_STREAK && state.nationalWins >= 2 && state.nationalWins > state.nationalLosses) return "contenderTest";
  return null;
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
  // prepareFight itself decides otherwise (or vice versa). See
  // naturalTitleShotReady for the full rule (tier-aware rank threshold,
  // plus the Premier-only provenAtTop5 gate).
  const wouldBeTitle = state.champion || naturalTitleShotReady(state.circuitTier, state.champion, state.streak, state.playerRank, state.provenAtTop5);
  if (wouldBeTitle) return prepareFight(state, "default");
  // Deliberate opportunity escalation (see regionalOpportunityFor/
  // nationalOpportunityFor above) -- checked before the ordinary roll, same
  // precedent as the title bypass just above: a fighter who has already
  // earned a specific test doesn't wait on the same dice roll an ordinary
  // fight does. pickRankedCandidate (unchanged) still owns which eligible
  // fighter fills it; the two-tier fallback mirrors every other caller of
  // this picker elsewhere in the file. On the (extremely rare) chance the
  // ranked pool is fully avoid-list-exhausted, fall through to the normal
  // roll below rather than stall the career waiting for a candidate.
  const deliberateOpportunity = regionalOpportunityFor(state) || nationalOpportunityFor(state);
  if (deliberateOpportunity) {
    const picked = pickRankedCandidate(state.divisionRoster, state.playerRank, state.recentOpponentIds)
      || pickRankedCandidate(state.divisionRoster, state.playerRank, []);
    if (picked) return prepareFight(state, "ranked", picked.fighter.id);
  }
  const roll = Math.random();
  // Career Presentation recovery pass, item 6: post-fight event
  // hierarchy. A major milestone (title win, a promotion, Premier
  // arrival, a 1st/3rd/5th defense) was just acknowledged --
  // suppressNextFlavorEvent (set once, in commitFight, alongside that
  // milestone) skips the next random flavor/development-event roll so
  // the moment gets room to breathe instead of immediately dissolving
  // into Training/Media/Off-Cycle filler. One-shot: consumed by this
  // roll whether or not it actually needed to suppress anything (so it
  // can never get stuck across multiple fights). Matchmaking agency (the
  // fightChoice menu -- real player agency, not flavor) and the required
  // contractNegotiation/campPlanning/weightMoveOffer decisions elsewhere
  // are never touched by this flag.
  const suppressFlavor = !!state.suppressNextFlavorEvent;
  const rolled = suppressFlavor ? { ...state, suppressNextFlavorEvent: false } : state;
  if (roll < 0.22) {
    // Matchmaking agency (choosing Easy/Ranked/Step-Up yourself) is
    // something a fighter earns, not something day-one gets -- a 0-0
    // rookie shouldn't be able to demand a ranked opponent. Gated on the
    // smallest existing signal (total fights so far), no new progression
    // field: before it clears, this same 22% probability slot just books
    // through the ordinary default path instead -- the promotion is still
    // choosing for you, exactly like every other fight that doesn't roll
    // into a fightChoice decision. Training/media/off-cycle below are
    // untouched; only this one branch is gated.
    const hasMatchmakingAgency = (rolled.record.w + rolled.record.l) >= 3;
    if (!hasMatchmakingAgency) return prepareFight(rolled, "default");
    // Computed once, right here -- fixed for the life of this decision
    // (same convention as trainingEvent's attr below), not re-rolled on
    // every render.
    const options = generateMatchmakerOptions(rolled.divisionRoster, rolled.rankPoints, rolled.playerRank, rolled.recentOpponentIds, rolled.circuitTier, rolled.streak, rolled.regionalEverBeatRanked, rolled.record);
    return { ...rolled, pendingDecision: { type: "fightChoice", options } };
  }
  if (roll < 0.30) return suppressFlavor ? prepareFight(rolled, "default") : { ...state, pendingDecision: { type: "trainingEvent", attr: pickWeakestSkill(state.base) } };
  if (roll < 0.36) return suppressFlavor ? prepareFight(rolled, "default") : { ...state, pendingDecision: { type: "mediaEvent" } };
  // Off-cycle content -- not tied to any particular fight, just building
  // fame between them. Kept rare (4% total) so it reads as a real event,
  // not a third flavor of the fight-week media roll above.
  if (roll < 0.38) return suppressFlavor ? prepareFight(rolled, "default") : { ...state, pendingDecision: { type: "offCycleEvent" } };
  return prepareFight(rolled, "default");
}

// Duplicate timeline ID hotfix: resolveTrainingEvent/resolveMediaEvent/
// resolveOffCycleEvent all keyed their timeline id as
// `${prefix}-${year}-${fightGlobalIndex}` -- unique for every OTHER timeline
// entry type (fight/circuitMove/rivalEvent/hypeEvent all fire at most once
// per commitFight, which is the only place fightGlobalIndex advances;
// campPlan/injury/coach*/weightMove* all fire at most once per year, via
// resolveCampPlanning/resolveWeightMoveOffer). These three are different:
// maybeFightChoice's post-fight roll can land on trainingEvent, mediaEvent,
// or offCycleEvent, each of which clears pendingDecision and loops right
// back through advanceCareer -> maybeFightChoice for a fresh roll -- so two
// or more of the SAME type can fire back-to-back before the next actual
// fight commits and fightGlobalIndex ticks forward, with `year` also
// unchanged across all of them. Two media events in the same gap could both
// become `media-5-9`, exactly the collision the Career V1 audit found.
// fightGlobalIndex itself must stay fight-only (bumping it here would
// corrupt every promotion/matchmaking check that reads it as "fights so
// far") and no other counter already tracks "how many non-fight events have
// fired," so this adds the smallest thing that does: one dedicated,
// monotonically increasing counter (timelineEventSeq, see initCareer),
// shared across all three event types and folded into the id as a trailing
// suffix. `state.timelineEventSeq || 0` means an old save from before this
// field existed just starts counting from 0 -- no migration, no rewritten
// history, and its old unsuffixed ids (`train-5-9`) can never collide with
// the new suffixed shape (`train-5-9-1`) since the strings simply differ.
function nextTimelineEventSeq(state) {
  return (state.timelineEventSeq || 0) + 1;
}

// CHIN excluded (Training Camp Rework V1, item 3/11) -- Training Event's
// "Address It" is a permanent-growth path, same restriction as Camp focus.
function pickWeakestSkill(base) {
  let worst = { key: TRAINABLE_KEYS[0], value: 999 };
  TRAINABLE_KEYS.forEach((k) => { if (base[k] < worst.value) worst = { key: k, value: base[k] }; });
  return worst.key;
}

// Training Camp Rework V1, item 11: the old model (+3 weakest, -1 to each
// of the two STRONGEST) could erode a signature strength by 7-8 points
// over a career just from repeatedly patching an unrelated weakness --
// audit-confirmed, and squarely against "Camp must not destroy signature
// strengths." Annual Camp (resolveCampPlanning) is now the primary
// permanent-growth system; Training Event stays a smaller, rarer
// contextual bonus on top of it -- same diminishing-returns curve, no
// permanent negative at all (the smallest identity-preserving fix that
// still keeps "Address It" meaningfully different from doing nothing).
function resolveTrainingEvent(state, attr, addressed) {
  const s = { ...state };
  if (addressed) {
    const before = s.base[attr];
    const gain = TRAINING_EVENT_BASE_GAIN * campDrMultiplier(before) * campStageMultiplier(s.year);
    s.base = { ...s.base, [attr]: clamp(before + gain, 30, 99) };
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
  const trainingSeq = nextTimelineEventSeq(s);
  s.timelineEventSeq = trainingSeq;
  s.timeline = [...s.timeline, { type: "trainingEvent", id: `train-${s.year}-${s.fightGlobalIndex}-${trainingSeq}`, attr, addressed }];
  s.pendingDecision = null;
  return s;
}

// A one-fight-only buff depending on how the player handles the hype/trash talk.
function resolveMediaEvent(state, fireBack) {
  const s = { ...state };
  s.mediaBuff = fireBack ? { attr: "POWER", delta: 4 } : { attr: "IQ", delta: 3 };
  const mediaSeq = nextTimelineEventSeq(s);
  s.timelineEventSeq = mediaSeq;
  s.timeline = [...s.timeline, { type: "mediaEvent", id: `media-${s.year}-${s.fightGlobalIndex}-${mediaSeq}`, fireBack }];
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
  const offCycleSeq = nextTimelineEventSeq(s);
  s.timelineEventSeq = offCycleSeq;
  s.timeline = [...s.timeline, { type: "offCycleEvent", id: `offcycle-${s.year}-${s.fightGlobalIndex}-${offCycleSeq}`, choice, fameAfter: s.fame }];
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
  // Natural path is naturalTitleShotReady (tier-aware rank threshold +
  // the Premier-only provenAtTop5 gate). Demand/Short-Notice rank
  // thresholds (<=3 / <=10, enforced in App.jsx) are unrelated and
  // untouched -- they don't call naturalTitleShotReady at all.
  const isTitleShot = !isContenderSeriesFight && !isCallout && (naturalTitleShotReady(s.circuitTier, s.champion, s.streak, s.playerRank, s.provenAtTop5) || choiceTag === "shortNoticeTitle" || choiceTag === "demandShot");
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
    // A callout's targetId is a specific fighter the player pointed at --
    // unlike a matchmaker pick (below), there's no equivalent "any fighter
    // matching this tier of difficulty" fallback that preserves what the
    // player actually chose. If that exact fighter isn't resolvable
    // anymore (division rebuilt by a same-fight promotion, roster
    // otherwise stale), silently booking a different opponent via
    // selectDivisionOpponent would violate the core invariant: what the
    // player selects must be who the player fights. Fail safe instead --
    // return the ORIGINAL, unmutated state (not the local s copy, and not
    // even the fightGlobalIndex bump above) so nothing is booked and
    // nothing changes. The caller's existing pendingDecision is left
    // exactly as it was (still the callout list for a normal callout,
    // simply nothing booked for a Mic Time confirm), which is already a
    // valid, truthful place for the player to land -- no new UI needed.
    if (!target) return state;
    picked = { fighter: target, rank: displayRankFor(s.divisionRoster, s.divisionRoster.indexOf(target)) };
  } else if (isMatchmakerPick) {
    const target = s.divisionRoster.find((f) => f.id === targetId);
    // Falls back to a fresh draw if the targeted fighter somehow isn't in
    // the roster anymore (e.g. the division regenerated between the offer
    // being shown and picked -- shouldn't happen inside one decision, but
    // never leave the player stuck on a dead pick). Reuses the SAME
    // eligibility-aware pickers generateMatchmakerOptions itself uses, not
    // a second copy of the rules -- a regenerated-roster booking must obey
    // the exact same Ranked/Step-Up invariants as a normal one. "easy"
    // alone keeps the old unconstrained draw, unchanged, per the audit
    // ("do not over-constrain Easy").
    if (target) {
      picked = { fighter: target, rank: displayRankFor(s.divisionRoster, s.divisionRoster.indexOf(target)) };
    } else if (choiceTag === "ranked") {
      picked = pickRankedCandidate(s.divisionRoster, s.playerRank, s.recentOpponentIds)
        // Avoid-list exhaustion is the only realistic reason the picker's
        // own internal ladder-wide widen would still come up empty here --
        // drop it (same picker, same rules, just less to avoid) rather
        // than ever falling through to an unranked substitute.
        || pickRankedCandidate(s.divisionRoster, s.playerRank, []);
    } else if (choiceTag === "stepUp") {
      // No freshly-drawn Easy option exists in this rebooking path -- draw
      // one the same way generateMatchmakerOptions does, purely as the
      // "harder than Easy" reference point Step-Up eligibility needs.
      const referenceEasy = selectDivisionOpponent(s.divisionRoster, s.rankPoints, false, s.recentOpponentIds, "easy", s.circuitTier, s.streak, s.regionalEverBeatRanked, s.record);
      picked = pickStepUpCandidate(s.divisionRoster, s.playerRank, referenceEasy.fighter, s.recentOpponentIds, s.streak)
        || pickStepUpCandidate(s.divisionRoster, s.playerRank, referenceEasy.fighter, [], s.streak)
        // Genuinely nobody clears the Step-Up bar even with nothing
        // avoided (the panel's own "No Step-Up Available" case, just hit
        // mid-flow instead of at generation time) -- degrade to Ranked's
        // guaranteed-non-null pick rather than ever falling through to the
        // unconstrained draw, so this booking still can't land on a
        // losing-record or bad-form opponent under a Step-Up tag.
        || pickRankedCandidate(s.divisionRoster, s.playerRank, s.recentOpponentIds)
        || pickRankedCandidate(s.divisionRoster, s.playerRank, []);
    }
    // Only "easy" (and the unreachable-in-practice absolute edge case)
    // ever falls through to here -- Ranked/Step-Up are both structurally
    // guaranteed non-null by the two-tier fallback above.
    if (!picked) picked = selectDivisionOpponent(s.divisionRoster, s.rankPoints, false, s.recentOpponentIds, choiceTag, s.circuitTier, s.streak, s.regionalEverBeatRanked, s.record);
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
      : selectDivisionOpponent(s.divisionRoster, s.rankPoints, isTitleFight, s.recentOpponentIds, choiceTag, s.circuitTier, s.streak, s.regionalEverBeatRanked, s.record);
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
  // instead of recomputing the identical thing. Camp's own development is
  // no longer a temporary per-fight overlay here -- it already wrote
  // permanently to s.base (see resolveCampPlanning), so agedNow already
  // reflects it, same as any other permanent change.
  let effective = agedNow;
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
  // Gameplan (Stand-Up/Ground/Balanced) is now chosen on the pre-fight
  // screen, where the opponent is actually known (see setFightStance) --
  // annual Camp is development-only. Starts neutral every fight; nothing
  // is silently chosen for the player.
  s.fightStance = "balanced";
  const stanceBias = 0;

  // Pre-fight odds -- the exact same deterministic computation resolveFight
  // itself will use a moment later at commit time, so what's shown here is
  // guaranteed to match what actually decides the fight, not a second,
  // possibly-drifted estimate.
  const preview = computeFightPreview(effective, s.reachScore, opp.attrs, stanceBias, playerTraits, opp.traits);

  s.pendingDecision = { type: "preFight" };
  s.pendingFight = {
    choiceTag, isTitleShot, isTitleDefense, isTitleFight, isCallout, isContenderSeriesFight,
    oppEntry, oppName, oppRank, opp, oppRecord,
    hype, effective, playerTraits, stanceBias, playerOverallNow,
    winProb: preview.winProb, matchup: preview.matchup,
    fightWeekLine: buildFightWeekLine(s, isTitleFight, isRivalFight, isContenderSeriesFight, isCallout),
    trashTalk: buildTrashTalk(oppName, preview.winProb, isTitleFight, isRivalFight, isContenderSeriesFight, isCallout),
    youOdds: formatOdds(preview.winProb), oppOdds: formatOdds(1 - preview.winProb),
  };
  return s;
}

// Training Camp Rework V1, items 17-18: relocates the Stand-Up/Ground/
// Balanced gameplan choice to the pre-fight screen, where the opponent is
// actually known (annual Camp no longer carries a stance at all -- it's
// development-only now). Recomputes the SAME preview commitFight will read
// a moment later (computeFightPreview) -- the odds/matchup shown are never
// a second, possibly-drifted estimate, same guarantee prepareFight itself
// already gives. A no-op if there's no fight actually pending.
function setFightStance(state, stance) {
  if (!state.pendingFight || !state.pendingDecision || state.pendingDecision.type !== "preFight") return state;
  const s = { ...state };
  const pf = { ...s.pendingFight };
  const stanceBias = stance === "ground" ? 0.08 : stance === "standup" ? -0.08 : 0;
  const preview = computeFightPreview(pf.effective, s.reachScore, pf.opp.attrs, stanceBias, pf.playerTraits, pf.opp.traits);
  pf.stanceBias = stanceBias;
  pf.winProb = preview.winProb;
  pf.matchup = preview.matchup;
  pf.youOdds = formatOdds(preview.winProb);
  pf.oppOdds = formatOdds(1 - preview.winProb);
  s.pendingFight = pf;
  s.fightStance = stance;
  return s;
}

// Training Camp Rework V1, item 17: a compact, opponent-aware GAMEPLAN
// insight for the pre-fight screen -- built ONLY from real, already-loaded
// opponent data (archetype, traits, the existing matchup read), never
// fabricated. Ground/Stand-Up leans are read from the SAME archetype/trait
// signals the engine already derives (see deriveTraits/ARCHETYPES); the
// "who's actually got the edge" read reuses the exact matchup labels
// buildMatchup already produces, not a second judgment.
function buildGameplanInsight(pf) {
  const opp = pf.opp;
  const m = pf.matchup;
  const GROUND_KEYS = ["WRESTLING", "GRAPPLING"];
  const STAND_KEYS = ["STRIKING", "POWER"];
  const oppGroundLean = opp.archetype === "Wrestler" || opp.archetype === "Submission Specialist"
    || opp.traits.includes("WRESTLER") || opp.traits.includes("SUB_THREAT");
  const oppStandLean = opp.archetype === "Striker" || opp.traits.includes("KO_THREAT");
  const yourGroundEdge = !!(m && GROUND_KEYS.includes(m.yourStrength.key));
  const yourStandEdge = !!(m && STAND_KEYS.includes(m.yourStrength.key));
  const favorable = m && (m.label === "Favorable Matchup" || m.label === "Slight Advantage");
  // Gameplan Truth Fix: the opponent-favored mirror of `favorable` above --
  // a Dangerous/Nightmare Matchup is exactly the case where buildMatchup()
  // found the opponent's own peak stat meaningfully ahead of yours, so a
  // note naming THEIR strongest attribute (when it falls outside the
  // archetype/trait coverage above) is truthful precisely when this is
  // true, never invented for an otherwise even or favorable matchup.
  const oppFavorable = m && (m.label === "Dangerous Matchup" || m.label === "Nightmare Matchup");

  if (oppGroundLean) {
    return yourGroundEdge
      ? { title: "Opponent leans heavily on the ground game.", body: "You match up well there -- ground-focused preparation can press the advantage.", suggestedStance: "ground" }
      : { title: "Opponent leans heavily on the ground game.", body: "Stand-Up preparation is recommended to keep this fight away from their strength.", suggestedStance: "standup" };
  }
  if (oppStandLean) {
    return yourStandEdge
      ? { title: "Opponent is a live striking threat.", body: "You hold real pop of your own -- Stand-Up preparation lets you meet it.", suggestedStance: "standup" }
      : { title: "Opponent is a live striking threat.", body: "Ground-focused preparation is recommended to take the fight out of the pocket.", suggestedStance: "ground" };
  }
  // Gameplan Truth Fix, item 6: the two opponent-lean checks above only
  // ever recognized Wrestling/Grappling/Striking/Power, via archetype and
  // the KO_THREAT/SUB_THREAT/WRESTLER traits -- when neither fires but the
  // opponent's own peak stat (m.oppStrength, the exact same buildMatchup()
  // truth the Scouting Report's own Attribute Edge row reads) is what's
  // actually making this matchup Dangerous/Nightmare, name it truthfully
  // instead of silently saying nothing about their real threat. Copy only
  // -- no mechanical penalty/bonus implied or added, suggestedStance stays
  // balanced since none of these four map to a specific phase the way
  // Wrestling/Grappling or Striking/Power do.
  if (oppFavorable && m.oppStrength.key === "SPEED") {
    return { title: "OPPONENT SPEED EDGE", body: "Don't let them dictate the tempo.", suggestedStance: "balanced" };
  }
  if (oppFavorable && m.oppStrength.key === "CARDIO") {
    return { title: "OPPONENT CARDIO EDGE", body: "Don't give them a comfortable high-output fight.", suggestedStance: "balanced" };
  }
  if (oppFavorable && m.oppStrength.key === "IQ") {
    return { title: "OPPONENT IQ EDGE", body: "Stay disciplined -- they make good reads.", suggestedStance: "balanced" };
  }
  if (oppFavorable && m.oppStrength.key === "CHIN") {
    return { title: "OPPONENT DURABILITY EDGE", body: "Don't rely on attritional damage alone.", suggestedStance: "balanced" };
  }
  if (favorable && yourStandEdge) {
    return { title: `You hold a clear ${ATTR_BY_KEY[m.yourStrength.key].label.toLowerCase()} edge.`, body: "Stand-Up preparation keeps this fight standing.", suggestedStance: "standup" };
  }
  if (favorable && yourGroundEdge) {
    return { title: `You hold a clear ${ATTR_BY_KEY[m.yourStrength.key].label.toLowerCase()} edge.`, body: "Ground-focused preparation lets you impose it.", suggestedStance: "ground" };
  }
  // Gameplan Truth Fix, items 3-5: the four skill keys buildMatchup() can
  // also name as YOUR top attribute but the stand/ground edge checks above
  // never recognized -- this is exactly the "SCOUTING says Favorable,
  // GAMEPLAN says even" contradiction the audit found. Same truthful-
  // interpretation treatment as the opponent-side branches above, copy
  // only, wording locked as specified. Chin intentionally never implies
  // reckless trading is strategically correct -- "don't rely on
  // durability alone" is part of the locked body text, not just flavor.
  if (favorable && m.yourStrength.key === "SPEED") {
    return { title: "SPEED EDGE", body: "You should be able to dictate the pace on the feet.", suggestedStance: "standup" };
  }
  if (favorable && m.yourStrength.key === "CARDIO") {
    return { title: "CARDIO EDGE", body: "Extend the fight and make them work.", suggestedStance: "balanced" };
  }
  if (favorable && m.yourStrength.key === "IQ") {
    return { title: "FIGHT IQ EDGE", body: "You hold the strategic advantage. Stay adaptable.", suggestedStance: "balanced" };
  }
  if (favorable && m.yourStrength.key === "CHIN") {
    return { title: "DURABILITY EDGE", body: "You can survive exchanges better, but don't rely on durability alone.", suggestedStance: "balanced" };
  }
  // Defensive fallback only (item 5): every real Favorable/Slight
  // Advantage case is now covered by one of the eight yourStrength.key
  // branches above (buildMatchup can only ever name one of the 8
  // SKILL_KEYS), so this should never actually fire in practice -- kept
  // truthful rather than silently reusing the "even matchup" copy below
  // for a matchup that Scouting Report is calling Favorable.
  if (favorable) {
    return { title: "YOU HOLD THE EDGE", body: "The numbers favor you. Stay disciplined and fight to your strengths.", suggestedStance: "balanced" };
  }
  // Genuinely even (or the opponent's own edge didn't clear oppFavorable) --
  // the only path that reaches here with m present is Even Matchup itself,
  // or a Dangerous/Nightmare Matchup whose oppStrength.key isn't one of
  // the four handled above (already covered by oppGroundLean/oppStandLean
  // for Wrestling/Grappling/Striking/Power, so this is the true "nothing
  // decisive either way" case).
  return { title: "An even matchup on paper.", body: "Balanced preparation keeps every option open.", suggestedStance: "balanced" };
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
    // Realism-v1 follow-up: has this Regional stint ever beaten an
    // actually-ranked opponent -- a permanent resume fact, NOT reset by a
    // later loss (streak itself still resets on any loss, unchanged right
    // below; this is deliberately a separate, non-resetting signal). A
    // streak-scoped version of this was tried first and rejected: it
    // distinguished "beat 4 unranked prospects" from "beat 4 real Regional
    // contenders" for the fast-track gate, but wiped out a genuine ranked
    // win the moment an otherwise-strong run took one unrelated loss
    // anywhere else, which measurably cost ELITE/GOAT-tier fighters extra
    // Regional time (median Regional fights roughly doubled) waiting for
    // an unbroken streak to also contain a ranked win. Scoped to Regional
    // only, same as nationalWins/nationalLosses are scoped to National.
    if (tierBefore === "CLF Regional" && oppRank != null) s.regionalEverBeatRanked = true;
  } else {
    s.record = { ...s.record, l: s.record.l + 1 };
    s.streak = 0;
    if (tierBefore === "CLF National") s.nationalLosses += 1;
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
    // tierBefore, not s.circuitTier -- a Regional/National title win can
    // trigger a same-fight promotion further down, and the reign belongs
    // to the tier it was actually won at, not wherever the fighter ends
    // up a few lines later.
    s.titleReignsByTier = { ...s.titleReignsByTier, [tierBefore]: (s.titleReignsByTier[tierBefore] || 0) + 1 };
    s.champion = true;
    if (s.record.l >= 2) s.wonTitleAsUnderdog = true;
  }
  if (isTitleDefense) {
    if (result.win) {
      s.titleDefenses += 1;
      s.titleDefensesByTier = { ...s.titleDefensesByTier, [tierBefore]: (s.titleDefensesByTier[tierBefore] || 0) + 1 };
    } else s.champion = false;
  }
  // Repeat-title-shot lock. Demand/Short-Notice bypass the natural
  // streak>=2 requirement by design (that's the whole point of "cash in
  // your ranking right now") -- but a title-shot loss or a lost defense
  // only costs playerRank a single +1 step, so without this a player
  // sitting at, say, rank 2 or rank 8 could click Demand/Short-Notice
  // again on the very next fightChoice screen and get an immediate
  // rematch against the exact thing that just beat them. One legitimate
  // win (of any kind, at this tier) clears it -- the natural
  // streak>=2/rank<=N path is completely unaffected either way, it never
  // reads this flag (enforced in App.jsx, not here -- see the button
  // gating there).
  if (result.win) {
    s.specialTitleShotLockedUntilWin = false;
  } else if (isTitleShot || isTitleDefense) {
    s.specialTitleShotLockedUntilWin = true;
  }
  // Premier natural-title-chase beat (see naturalTitleShotReady). Set by
  // a win recorded while ALREADY ranked Top 5 walking into this fight
  // (playerRankBefore, not the just-updated after-value -- the fight
  // that first climbs INTO Top 5 doesn't itself count as the proof win,
  // only a fight fought AS a Top 5 fighter does). Cleared by any loss --
  // no hidden "earned" state survives a loss; a fresh climb back
  // (including after losing the belt) has to prove itself again, same
  // as the first time.
  if (tierBefore === "CLF PREMIER") {
    if (result.win && playerRankBefore != null && playerRankBefore <= 5) s.provenAtTop5 = true;
    else if (!result.win) s.provenAtTop5 = false;
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
  //
  // nationalWins > nationalLosses added after the release-gate sim found
  // the opponent-quality-of-wins bar alone let a fighter lose indefinitely
  // (worst observed: 2-12) and still earn the same invite as a clean 2-0 --
  // the wins met the bar, but nothing looked at the losses piling up
  // alongside them. One boolean, same nationalLosses scoping/persistence
  // rules as nationalWins above (National-fights-only, survives a
  // Contender Series bounce-back): you must be winning more than you're
  // losing at National, on top of the existing quality-of-wins bar.
  // Realism-v1 follow-up: raising this to 3 was tried first and reverted --
  // it did shift more National promotions to the title route, but cost
  // ELITE/GOAT-tier Premier-reach and championship rate along the way (the
  // same kind of runway cost the Regional ceiling caused, just smaller).
  // Loosening the title path's OWN rank bar instead (see
  // NATIONAL_TITLE_RANK_THRESHOLD above, now 7) gets the same "the gate
  // shouldn't win the race by default" result without slowing the gate
  // down for everyone, elites included.
  const nationalGatePass = s.nationalWins >= 2
    && s.nationalWins > s.nationalLosses
    && (s.nationalOppQualitySum / Math.max(1, s.nationalWins)) >= 65;
  // National title-path priority: the gate formula itself (above) is
  // untouched -- this only decides whether it's allowed to fire on THIS
  // fight. Two cases where it must defer to the National title
  // opportunity instead of silently promoting past it:
  //  1) this fight WAS itself a National title shot that was LOST -- a
  //     loss just resumes normal National progression (streak resets,
  //     the gate stays available for later fights), not "also get swept
  //     into Contender Series in the same fight." A WON title shot is
  //     unaffected -- justWonTierTitle already promotes via the title
  //     route in the very next `||` clause below, same as before.
  //  2) this ORDINARY win's own rank climb (previewed here, read-only,
  //     via the same previewRankClimb the division-update block below
  //     will apply for real a few lines later) just pushed the fighter
  //     to playerRank<=6 with streak already >=2 -- they've earned the
  //     shot this exact fight, so the natural wouldBeTitle check on the
  //     next booking should get first crack at it, not the gate.
  const nationalRankPreview = tierBefore === "CLF National"
    ? previewRankClimb(playerRankBefore, oppRank, result.win, result.method)
    : null;
  const nationalTitleEligibleNow = tierBefore === "CLF National" && !s.champion
    && s.streak >= 2 && nationalRankPreview != null && nationalRankPreview <= NATIONAL_TITLE_RANK_THRESHOLD;
  const nationalGateShouldDefer = isTitleShot || nationalTitleEligibleNow;
  let resetForFreshTier = false;
  // True only for the National -> Contender Series branch below: champion
  // gets cleared without a fresh-tier reset (the National roster/standing
  // is kept, not rebuilt), so the belt-taking block further down needs its
  // own guard against re-crowning the player right after this clears them.
  let leftBeltBehindForContenderSeries = false;
  // Universe Events V1: set below, in whichever promotion branch actually
  // clears a belt the player was reigning champion of WITHOUT a resolving
  // fight (championAfterFight, not championBefore -- covers both "already
  // champion, promoted via streak" and "just won the title THIS fight,
  // immediately promoted same fight"). Applied later, alongside
  // appendPlayerBout, once `worldTick`/`s.universe` are available -- see
  // this branch's own report, Section 33-38.
  let titleTransitionPending = null;
  // Realism pass, item 16/17: the fast-track route (Path B) is meant to be
  // the exception a dominant prospect earns, not the default -- but a flat
  // streak>=4 rewards 4 wins over anyone, including the unranked prospects
  // who fill most early Regional bookings, exactly as easily as 4 wins over
  // real ranked competition. Requiring that this Regional stint has at
  // some point beaten an actually-ranked opponent (regionalEverBeatRanked
  // -- a permanent resume fact for the stint, not reset by an unrelated
  // loss elsewhere; see its own comment in initCareer) distinguishes the
  // two without an absolute rankPoints bar -- that was tried first and,
  // because early matchmaking mostly draws from the unranked pool
  // regardless of player quality, ended up gating strong AND weak fighters
  // alike, measurably costing ELITE/GOAT-tier Premier-reach and
  // championship rate along with the intended scrub-farming case.
  // An escape valve at a longer, still-clean streak (>=7) covers the
  // "exceptional undefeated run" case even when the ranked-opponent draw
  // never came up by chance -- Path B should stay reachable by dominance
  // alone (per the realism-pass brief's own "fast-track should still be
  // earnable by an exceptional run" direction), just require more of it
  // when that dominance was never actually tested against real competition.
  const regionalFastTrackReady = s.streak >= 4 && s.regionalEverBeatRanked;
  const regionalDominanceOverride = s.streak >= 7;
  // Promotion agency pass: earning eligibility used to auto-transition the
  // player into National the instant it was met -- the decision had
  // already been made mechanically before the milestone screen even
  // rendered. Now it creates an OFFER (pendingDecision, same "earn it, the
  // player decides" pattern already used for weightMoveOffer/
  // contractNegotiation) instead of a fait accompli; see
  // resolvePromotionOffer for what actually applies the move on accept.
  // Regional/circuitTier/streak/rank/champion all stay exactly as they are
  // this fight either way -- nothing here changes state, it only decides
  // whether to surface the offer.
  const regionalPromotionEligible = s.circuitTier === "CLF Regional" && (justWonTierTitle || regionalFastTrackReady || regionalDominanceOverride);
  // Suppresses re-asking on literally every subsequent win once already
  // declined once (streak>=7 alone would otherwise re-qualify every single
  // fight) -- re-arms on the next loss, since dropping out of the current
  // run is the simplest believable signal that "prove it again" applies.
  // Not itself an exploit fix (see resolvePromotionOffer's own comment):
  // nothing about staying in Regional inflates National's starting point,
  // since rank/rankPoints/streak all still reset to zero whenever the
  // player eventually does accept.
  const regionalPromotionOfferJustEarned = regionalPromotionEligible && !s.promotionOfferDeclined;
  if (!result.win && s.circuitTier === "CLF Regional") s.promotionOfferDeclined = false;
  if (s.circuitTier === "CLF National" && (justWonTierTitle || (nationalGatePass && !nationalGateShouldDefer))) {
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
    if (championAfterFight) titleTransitionPending = { circuit: "CLF National", division: s.division, reason: "contenderSeries" };
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
  // The repeat-shot lock is scoped to "this tier, until the next win" --
  // it must never leak into a new tier's own Demand/Short-Notice
  // eligibility (a fresh circuit is a fresh start, same as streak/rank/
  // roster resets already are). Defensive on every tier change, not just
  // resetForFreshTier ones -- covers National->CS (standings-intact, no
  // reset) too.
  if (tierChanged) s.specialTitleShotLockedUntilWin = false;
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
    // National standing already earned instead of erasing it. s.circuitTier
    // is already the NEW tier at this point (set above).
    //
    // Universe Foundation V1: the destination division has already existed
    // since career start (or migration) -- this now SWITCHES the player
    // into that pre-existing world instead of generating a fresh one every
    // time. getDivisionForTier's own old-save fallback isn't safe to use
    // directly here (s.divisionRoster still holds the tier just LEFT at
    // this exact point, and its generic "does circuitTier match" check
    // would incorrectly match the tier we just switched s.circuitTier to),
    // so an unmigrated save falls back to the pre-Foundation-V1 behavior
    // explicitly instead.
    const destinationDivision = s.universe
      ? getDivisionForTier(s, s.circuitTier)
      : buildDivision(s.circuitTier);
    syncActiveDivision(s, destinationDivision || buildDivision(s.circuitTier));
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

  // --- update the persistent division + one world tick -------------------
  // NPC World Movement + Bout Ledger V1: your opponent's record changes
  // from fighting you (still true), but the rest of the universe no
  // longer just "fights among itself" invisibly for whichever division
  // happens to be active -- it advances through one recorded world tick
  // covering all three persistent circuits at once (see runWorldTick's own
  // comment for why). tierBefore, not s.circuitTier, decides which tier
  // the opponent-update below targets -- the tier the fight ACTUALLY
  // happened in, captured before any promotion logic above could have
  // already changed s.circuitTier/s.divisionRoster.
  {
    const tierBeforeKey = circuitToUniverseKey(persistentTierForActiveRoster(tierBefore));
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
    //
    // Universe Foundation V1, fresh-tier ranking bug fix: this line used to
    // run completely unguarded, including on the exact fight that triggers
    // resetForFreshTier -- so a 4-0 Regional prospect whose fast-track win
    // was over, say, Regional #12 got `previewRankClimb(null, 12, true,
    // ...)` applied AFTER s.playerRank had already been reset to null.
    // Confirmed by direct reproduction (see that branch's own report).
    // Guarded against resetForFreshTier: winning the Regional (or Contender
    // Series) title just reset s.champion/s.playerRank back to a clean
    // slate on purpose -- a nobody again, same as stepping up a weight
    // class. Without this guard, this block re-applied the OLD tier's
    // title win on TOP of that reset. Also guarded against
    // leftBeltBehindForContenderSeries: that branch above already cleared
    // s.champion and set the correct playerRank for a National title won
    // on the way into Contender Series -- letting this re-run on top of it
    // would set playerRank back to 0 right after champion was cleared to
    // false, the exact desync this whole guard exists to prevent.
    const skipRankUpdate = resetForFreshTier || leftBeltBehindForContenderSeries;
    if (!skipRankUpdate) {
      s.playerRank = previewRankClimb(s.playerRank, oppRank, result.win, result.method);
      if (isTitleShot && result.win) s.playerRank = 0;
    }
    // Player bout ledger entry -- one per committed player fight, EVERY
    // tier, Contender Series included (its circuit reads truthfully as
    // "CLF Contender Series" even though there's no persistent CS
    // division backing it -- see this branch's own report). Appended
    // before the opponent/world-tick updates below so its bout id is the
    // lowest -- and therefore first -- of this tick's ledger entries, a
    // stable convention (see appendPlayerBout's own comment), not a
    // correctness requirement.
    const worldTick = (s.universe.worldTickSeq || 0) + 1;
    s.universe = appendPlayerBout(s.universe, {
      circuit: tierBefore, year: s.year, worldTick,
      division: state.division,
      fighterAId: PLAYER_BOUT_ID, fighterBId: oppEntry.id,
      winnerId: result.win ? PLAYER_BOUT_ID : oppEntry.id,
      method: result.method, round: stats.finishRound || totalRounds,
      titleFight: isTitleFight,
      championBeforeId: isTitleDefense ? PLAYER_BOUT_ID : (isTitleShot ? oppEntry.id : null),
      rankABefore: playerRankBefore, rankBBefore: oppRank,
      recordABefore: { ...state.record }, recordBBefore: { ...oppEntry.record },
      // A Contender Series opponent is never added to any persistent
      // roster (generateContenderSeriesOpponent, untouched) -- their id
      // (cs-<timestamp>-<random>) can never be resolved back to a name via
      // universe.divisions the way every other bout's participants can.
      // Captured directly on the bout itself, ONLY for this one case,
      // rather than inventing a fake persistent-roster entry for a fighter
      // who was never part of one -- a future Event Archive would
      // otherwise have no way to render a CS card's opponent identity at
      // all (see this branch's own report).
      opponentName: isContenderSeriesFight ? oppEntry.name : undefined,
      opponentArchetype: isContenderSeriesFight ? oppEntry.archetype : undefined,
    });
    // Opponent's own record/form update, plus any title swap/demotion --
    // skipped entirely for a Contender Series fight (that opponent isn't
    // part of any persistent roster -- generateContenderSeriesOpponent,
    // untouched -- and the division above shouldn't move on a fight it
    // wasn't actually part of), and internally no-ops the rank-sensitive
    // half via the exact same skipRankUpdate guard as the player-state
    // update just above.
    if (!isContenderSeriesFight) {
      s.universe = applyPlayerOpponentUpdateToUniverse(
        s.universe, tierBeforeKey, oppEntry, result, isTitleShot, isTitleDefense, skipRankUpdate
      );
    }
    // One world tick, unconditionally -- Regional/National/Premier all
    // advance once regardless of tier or Contender Series (section 4/32 of
    // the underlying task). playerHoldsBelt reads championAfterFight
    // (captured earlier, before any tier-promotion reset) so a same-fight
    // title win correctly protects the tier just won, and a same-fight
    // promotion correctly leaves the tier just left behind eligible for
    // its own vacancy handling starting next tick.
    s.universe = runWorldTick(s.universe, worldTick, tierBefore, championAfterFight, oppEntry.id, s.year, state.division);
    // Universe Events V1: apply the deferred title-transition fact (set
    // above, in the promotion branch that actually cleared a belt without
    // a resolving fight) now that worldTick/s.universe are available. Must
    // run AFTER runWorldTick, not before -- Section 33-38's whole point is
    // that this is a fact about the OLD tier becoming vacant at this
    // exact tick, and runWorldTick above is what may go on to actually
    // fill that vacancy this same or a later tick; recording the
    // vacancy-cause first keeps a future lineage reconstruction's
    // "vacated, then (maybe same tick) won" ordering honest.
    if (titleTransitionPending) {
      s.universe = appendTitleTransition(s.universe, { ...titleTransitionPending, worldTick, year: s.year });
    }
    // Re-bind the alias to whichever tier is ACTIVE now (post-promotion-
    // aware) -- this is the ONE place divisionRoster is written for the
    // rest of this function; both the promotion switch above and every
    // universe mutation just made are already reflected in
    // s.universe.divisions by this point.
    s.divisionRoster = s.universe.divisions[circuitToUniverseKey(persistentTierForActiveRoster(s.circuitTier))];
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

  // Fight Result + Retirement cleanup, item 12: lightweight, non-blocking
  // rank-achievement flags for FightResultCard -- first-time-ever entry
  // into Top 5 / #1 contender, derived from real rankAfter, gated on the
  // career-long everReached* flags so bouncing in and out of the same
  // threshold later never re-fires it. Excludes becoming champion outright
  // (championAfterFight) -- that already gets the much bigger "AND NEW"
  // milestone treatment, and reaching #1 or Top 5 legitimately again after
  // a title loss and rebuild is still that career's first REAL climb back,
  // so the flags are deliberately never reset either.
  const firstTop5 = !s.everReachedTop5 && !championAfterFight && playerRankAfterFight != null && playerRankAfterFight <= 5;
  const firstNumberOne = !s.everReachedNumberOne && !championAfterFight && playerRankAfterFight === 1;
  if (firstTop5) s.everReachedTop5 = true;
  if (firstNumberOne) s.everReachedNumberOne = true;

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
  // Realism pass, item 7: a won Step-Up now always counts as a statement
  // win too, on top of the existing raw-overall bar -- reuses the existing
  // statementWins Legacy term (statementWins*5, see calculateLegacy) and
  // Mic Time trigger (qualifiesForMicTime reads e.statement) rather than
  // inventing a separate reward path. Deliberately the smallest possible
  // hook into "a genuinely dangerous fight, won, should feel like it
  // mattered" -- the global Legacy formula itself is untouched.
  const isStatement = result.win && (opp.overall >= 88 || choiceTag === "stepUp");
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

  // Mic Time -- computed once, right here, off the fields this same commit
  // already produced (never a second fight-result derivation), and stored
  // on the fight entry itself so it's fixed for the life of the spotlight
  // instead of re-rolling on every render. null when this win didn't earn
  // the moment, or when it's not a real callout-eligible fight to begin
  // with (a title fight, a Contender Series showcase, or a loss).
  //
  // Also excluded whenever THIS fight changed the circuit tier
  // (!tierChanged): a non-title win can still trigger a same-fight
  // promotion (Regional->National on streak>=4, National->Contender
  // Series on the gate) -- audited and confirmed as the root cause of
  // stale-circuit Mic Time targets. Without this, a target generated here
  // either gets drawn from the roster the promotion JUST rebuilt (Regional
  // case -- a National fighter mislabeled with the old tier) or, worse,
  // resolves later against a divisionRoster that's fine but with
  // careerState.circuitTier already advanced underneath it (National->CS
  // case -- the resulting fight gets permanently tagged with the wrong
  // tier, corrupting its Legacy multiplier, purse, and the National
  // win/quality gate that got the player into CS in the first place). A
  // tier-changing fight already gets the bigger moment (a promotion, or a
  // combined title+promotion milestone) -- losing the Mic Time follow-up
  // on that one specific fight is a legibility improvement, not a loss.
  const micTimeTargets = (!isContenderSeriesFight && !isTitleFight && !tierChanged
    && qualifiesForMicTime({ win: result.win, bonusType, statement: isStatement, rivalry: isRivalry, rankBefore: playerRankBefore, rankAfter: playerRankAfterFight, oppRank, underdogWin: isUnderdogWin }))
    ? generateMicTimeTargets(s.divisionRoster, playerRankAfterFight, s.rivals, [oppEntry.id, ...(s.recentOpponentIds || [])], { rankBefore: playerRankBefore, rankAfter: playerRankAfterFight, oppRank })
    : null;

  const timeline = [...s.timeline];
  // pendingMilestone mirrors truth already written elsewhere -- the
  // circuitMove timeline entry below, and the titleReignsByTier/
  // titleDefensesByTier counters above -- one truth, several live
  // presentations. Never a second progression engine: circuitTier and the
  // title counters already changed above, this only decides what the live
  // acknowledge screen shows.
  //
  // A Regional/National title win is ITSELF what triggers that same-fight
  // promotion (see justWonTierTitle in the promotion gate above), so on
  // that fight both a title win and a tier change are true at once --
  // rather than let two milestone payloads compete for the single
  // pendingMilestone slot (or silently drop one), this folds the
  // promotion into ONE combined titleWin milestone via promotedTo. The
  // circuitMove TIMELINE entry below is unconditional on tierChanged
  // either way, exactly as before -- only which LIVE screen presents it
  // branches here; a title win never suppresses that timeline write.
  s.pendingMilestone = null;
  if (tierChanged) {
    const promoted = CLF_TIER_ORDER.indexOf(s.circuitTier) > CLF_TIER_ORDER.indexOf(tierBefore);
    timeline.push({ type: "circuitMove", id: `circuit-${s.fightGlobalIndex}`, promoted, from: tierBefore, to: s.circuitTier });
    s.pendingMilestone = justWonTierTitle
      ? { type: "titleWin", tier: tierBefore, division: s.division, promotedTo: s.circuitTier }
      : { type: "circuitMove", promoted, from: tierBefore, to: s.circuitTier };
  } else if (justWonTierTitle) {
    // No further tier to climb -- Premier in practice, since a Regional or
    // National title win always promotes in the same fight (see the
    // promotion gate above), so a title win at either of those tiers can
    // never reach this branch.
    s.pendingMilestone = { type: "titleWin", tier: tierBefore, division: s.division, promotedTo: null };
  } else if (isTitleDefense && result.win && [1, 3, 5].includes(s.titleDefensesByTier[tierBefore])) {
    // Every successful defense gets the "AND STILL" fight-result treatment
    // (see the fight timeline entry's titleDefenseCount below); only the
    // 1st/3rd/5th also get a blocking live acknowledgment.
    s.pendingMilestone = { type: "titleDefenseMilestone", tier: tierBefore, division: s.division, defenseCount: s.titleDefensesByTier[tierBefore] };
  }
  // Career Presentation recovery pass, item 6/7: any of the three
  // pendingMilestone shapes above (a title win, a combined title+
  // promotion, a promotion alone, or a 1st/3rd/5th title defense) is
  // exactly the "major career moment" list this flag targets -- one flag,
  // read once by maybeFightChoice's next roll, so a random flavor/
  // development event never wedges in right on top of it.
  if (s.pendingMilestone) s.suppressNextFlavorEvent = true;
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
    // Same fight-time-truth reasoning as circuitTier just above -- a weight
    // move (rare, resolved at a year boundary) can change state.division
    // later in the career, so title/pre-fight copy reading this fight back
    // later must use what was true THEN, not state.division now.
    circuitTier: tierBefore, division: s.division, eventNumber, cardPosition,
    onStyle: s.careerStyle && s.careerStyle !== "Balanced" ? s.styleIsNaturalFit : null,
    win: result.win, method: result.method,
    titleShot: isTitleShot, titleDefense: isTitleDefense, shortNotice: choiceTag === "shortNoticeTitle", demanded: choiceTag === "demandShot",
    // Post-increment defense count for a successful defense (1st, 2nd, 3rd,
    // ...) -- computed once, here, off the exact same
    // titleDefensesByTier[tierBefore] the milestone check above reads, so
    // the "AND STILL -- Nth TITLE DEFENSE" fight-result treatment always
    // agrees with whichever fights (1st/3rd/5th) also got a live milestone.
    // null on anything that isn't a successful defense (a loss, a title
    // shot, an ordinary fight) -- FightResultCard treats null as "not a
    // defense," never as "0th defense."
    titleDefenseCount: (isTitleDefense && result.win) ? s.titleDefensesByTier[tierBefore] : null,
    contenderSeries: isContenderSeriesFight, calledOut: isCallout,
    rivalry: isRivalry, statement: isStatement, bonusType, interview, underdogWin: isUnderdogWin,
    micTimeTargets,
    // Raw playerRank/champion flags, not labels -- rankLabel() renders
    // these at display time, same convention as yearEnd's
    // rankBefore/rankAfter. playerRank is the real ladder position (the
    // single source of truth for anything shown as "my ranking"); the
    // internal rankPoints snapshots are kept too, unrendered, purely for
    // anything that still legitimately wants the hidden momentum value.
    rankBefore: playerRankBefore, championBefore, rankAfter: playerRankAfterFight, championAfter: championAfterFight,
    // First-time-only rank achievement (see above) -- computed once, here,
    // never re-derived at display time.
    firstTop5, firstNumberOne,
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
  s.pendingDecision = triggerContractNegotiation ? { type: "contractNegotiation" }
    : regionalPromotionOfferJustEarned ? { type: "promotionOffer", tier: "CLF National", fromTier: "CLF Regional" }
    : null;
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

function finishCareerState(rawState) {
  // Universe Events V1, Section 33-38: retirement while holding a belt is
  // the third (and last) non-fight way a title can be left behind --
  // record it the same way promotion/Contender-Series/weight-move already
  // do, before anything else below reads state.universe.
  const state = (rawState.universe && rawState.champion)
    ? { ...rawState, universe: appendTitleTransition(rawState.universe, {
        circuit: rawState.circuitTier, division: rawState.division,
        worldTick: rawState.universe.worldTickSeq || 0, year: rawState.year, reason: "retirement",
      }) }
    : rawState;
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
    if (s.pendingMilestone) {
      // Presentation-only -- nothing to decide, never hold fast-forward
      // waiting on a UI acknowledgment that can't happen here. Doesn't
      // change the underlying progression outcome at all, only whether a
      // live screen was shown for it.
      s = resolveMilestone(s);
    } else if (s.pendingDecision) {
      if (s.pendingDecision.type === "campPlanning") {
        // Training Camp Rework V1, item 20: fast-forward now exercises the
        // real development system too -- always addresses the current
        // weakest directly-trainable attribute (CHIN excluded), the same
        // instinct a player patching gaps would have, rather than skipping
        // Camp's actual effect by picking no focus every year.
        s = resolveCampPlanning(s, { focus: focusForWeakestTrainable(s.base), campQuality: "full" });
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
      } else if (s.pendingDecision.type === "promotionOffer") {
        // Unlike weightMoveOffer (a lateral, take-it-or-leave-it move),
        // declining here indefinitely would leave a fast-forwarded career
        // stuck farming Regional forever -- climbing the circuit ladder is
        // the actual point of a simulated career, so the sensible default
        // (matching campPlanning's own "do what an engaged player would
        // do" fast-forward philosophy, not weightMoveOffer's "avoid any
        // change" one) is to accept.
        s = resolvePromotionOffer(s, true);
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
  // Tier-aware résumé totals -- only ever summed from entries that actually
  // recorded a titleReignsByTier breakdown (see saveCareerToHistory). Older
  // entries still count toward the flat `championships` total above (and
  // metaRankFor, unchanged -- see decision 13), they just never get
  // guessed into a specific tier here.
  const premierChampionships = careerHistory.reduce((s, c) => s + ((c.titleReignsByTier && c.titleReignsByTier["CLF PREMIER"]) || 0), 0);
  const nationalChampionships = careerHistory.reduce((s, c) => s + ((c.titleReignsByTier && c.titleReignsByTier["CLF National"]) || 0), 0);
  const regionalChampionships = careerHistory.reduce((s, c) => s + ((c.titleReignsByTier && c.titleReignsByTier["CLF Regional"]) || 0), 0);
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
    premierChampionships, nationalChampionships, regionalChampionships,
    hofCareers,
    bestRecord,
    favoriteFighter,
    // Unchanged input on purpose (decision 13, deferred) -- metaRankFor
    // still keys off the flat total, not the tier-aware breakdown above.
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
  CAMP_FOCUSES,
  CLF_TIERS,
  CONTRACT_TYPES,
  DIVISION_SIZE,
  STYLE_DESCRIPTIONS,
  TRAINABLE_KEYS,
  TRAIT_DEFS,
  PLAYER_BOUT_ID,
  advanceCareer,
  applyAging,
  applyPlayerOpponentUpdateToUniverse,
  bestFitArchetypeFlat,
  buildDivision,
  buildFreshUniverse,
  resolveLightweightBout,
  runWorldTick,
  runWorldTickForDivision,
  EVENT_SCHEMA_VERSION,
  freshEventNumbers,
  eventNumberKeyFor,
  orderBoutsForCard,
  finalizeEventsForTick,
  appendTitleTransition,
  captureFighterIdentities,
  migrateUniverseEvents,
  buildGameplanInsight,
  circuitToUniverseKey,
  persistentTierForActiveRoster,
  normalizeUniverseState,
  getActiveDivision,
  getDivisionForTier,
  migrateStateToUniverse,
  calculateLegacy,
  campDrMultiplier,
  campStageMultiplier,
  clfTier,
  commitFight,
  computeAchievements,
  computePlayerProfile,
  computeFightPreview,
  computeWinProbability,
  currentWinStreak,
  deriveTraits,
  estimatePhaseControl,
  fastForwardCareer,
  focusForWeakestTrainable,
  generateCalloutTargets,
  generateMatchmakerOptions,
  generateMicTimeTargets,
  generateOpponentProfile,
  hasCalloutAccess,
  initCareer,
  isHotContender,
  isOnLosingSkid,
  maybeFightChoice,
  metaRankFor,
  phaseWeightedOutput,
  playSfxForTransition,
  prepareFight,
  previewCampFocus,
  previewRankClimb,
  rankBadge,
  rankLabel,
  rankToTierCls,
  recentLosses,
  recentWins,
  resolveCampPlanning,
  resolveContractNegotiation,
  resolveFight,
  resolveMediaEvent,
  resolveMilestone,
  resolveOffCycleEvent,
  resolvePromotionOffer,
  resolveTrainingEvent,
  resolveWeightMoveOffer,
  runFight,
  setFightStance,
  verdictFor,
  VERDICT_ORDER,
};
