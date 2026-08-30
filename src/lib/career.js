import { ATTRS, SKILL_KEYS, ATTR_BY_KEY } from "../data/attrs.js";
import { clamp, slugify } from "./utils.js";
import { shuffle } from "./rng.js";
import { sfx } from "./audio.js";
import { generateOpponentNames } from "../data/fighters.js";

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

function computeFinishOdds(attacker, defender, phase) {
  const koPotential = (attacker.POWER * attacker.STRIKING / 100) * ((100 - defender.CHIN) / 100) * phase.standShare * 1.4;
  const subPotential = (attacker.GRAPPLING * attacker.WRESTLING / 100) * phase.groundShare * 1.4;
  const finishTotal = koPotential + subPotential;
  const decisionWeight = Math.max(12, 55 - finishTotal);
  return { koPotential, subPotential, decisionWeight };
}

function rollMethod(odds) {
  const total = odds.koPotential + odds.subPotential + odds.decisionWeight;
  const roll = Math.random() * total;
  if (roll < odds.koPotential) return "KO/TKO";
  if (roll < odds.koPotential + odds.subPotential) return "Submission";
  return "Decision";
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
// enough to overturn a stat mismatch on their own.
function traitModifiers(traits) {
  const m = { winProbDelta: 0, koBoost: 0, subBoost: 0, decBoost: 0 };
  (traits || []).forEach((t) => {
    if (t === "KO_THREAT") m.koBoost += 6;
    if (t === "SUB_THREAT") m.subBoost += 6;
    if (t === "PACE_SETTER") m.decBoost += 5;
    if (t === "COUNTER_STRIKER") m.winProbDelta += 0.02;
    if (t === "PRESSURE_FIGHTER") m.winProbDelta += 0.015;
    if (t === "IRON_CHIN") m.decBoost += 2;
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

function resolveFight(player, reachScore, opp, stanceBias, playerTraits, oppTraits) {
  const phase = estimatePhaseControl(player, opp, stanceBias);
  const pMod = traitModifiers(playerTraits);
  const oMod = traitModifiers(oppTraits);
  const winProb = clamp(computeWinProbability(player, opp, phase, reachScore) + pMod.winProbDelta - oMod.winProbDelta, 0.05, 0.95);
  const win = Math.random() < winProb;
  const matchup = buildMatchup(player, opp);

  if (win) {
    const odds = computeFinishOdds(player, opp, phase);
    odds.koPotential += pMod.koBoost;
    odds.subPotential += pMod.subBoost;
    odds.decisionWeight += pMod.decBoost;
    const method = rollMethod(odds);
    return { win: true, method, phase, winProb, matchup, narrative: buildFightNarrative(phase, { win: true, method }, playerTraits || []) };
  }
  const odds = computeFinishOdds(opp, player, phase);
  odds.koPotential += oMod.koBoost;
  odds.subPotential += oMod.subBoost;
  odds.decisionWeight += oMod.decBoost;
  const rawMethod = rollMethod(odds);
  const method = rawMethod === "Decision" ? "Decision Loss" : `${rawMethod} Loss`;
  return { win: false, method, phase, winProb, matchup, narrative: buildFightNarrative(phase, { win: false, method }, playerTraits || []) };
}

function updateRanking(rankPoints, win, oppOverall, isTitleFight) {
  if (win) {
    const delta = 8 + Math.max(0, oppOverall - 70) * 0.4 + (isTitleFight ? 6 : 0);
    return clamp(rankPoints + delta, 0, 100);
  }
  const softenedBy = Math.max(0, oppOverall - 70) * 0.15;
  const delta = 8 + Math.max(0, 70 - oppOverall) * 0.3 + (isTitleFight ? 4 : 0) - softenedBy;
  return clamp(rankPoints - delta, 0, 100);
}

function rankLabel(rankPoints, champion) {
  if (champion) return "Champion";
  if (rankPoints >= 88) return "#1 Contender";
  if (rankPoints >= 75) return "Top 5";
  if (rankPoints >= 60) return "Top 10";
  if (rankPoints >= 40) return "Top 15";
  return "Unranked";
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

function circuitTierFor(rankPoints, champion) {
  if (champion || rankPoints >= 55) return "CLF PREMIER";
  if (rankPoints >= 25) return "CLF Contender Series";
  if (rankPoints >= 8) return "CLF National";
  return "CLF Regional";
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

function generateOpponentRecord(overall, fightIndexContext, tier) {
  const experience = clamp(Math.round(fightIndexContext * 0.6 + (overall - 50) * 0.3), 3, 40);
  let winRate;
  if (tier === "champion") winRate = clamp(0.72 + (overall - 85) / 200, CHAMPION_WIN_FLOOR, 0.92);
  else if (tier === "ranked") winRate = clamp(0.58 + (overall - 70) / 150, RANKED_WIN_FLOOR, 0.85);
  else winRate = clamp(0.4 + (overall - 60) / 120, 0.3, 0.75);
  const wins = Math.round(experience * winRate);
  const losses = Math.max(0, experience - wins);
  return { w: wins, l: losses };
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

function verdictFor(score) {
  if (score >= 300) return "Generational Talent";
  if (score >= 225) return "First-Ballot Hall of Famer";
  if (score >= 160) return "Hall of Fame";
  if (score >= 105) return "Fringe Hall of Famer";
  if (score >= 60) return "Legitimate Contender";
  if (score >= 22) return "Journeyman";
  return "Prospect Who Never Broke Through";
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
  return {
    id: `div-${seedIndex}-${slugify(name)}`,
    name,
    attrs: profile.attrs,
    overall: profile.overall,
    archetype: profile.archetype,
    traits: profile.traits,
    record: generateOpponentRecord(profile.overall, 8 + Math.floor(Math.random() * 12), tier),
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
      applyRoundLoss(challenger);
    } else {
      challenger.record.w += 1;
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
      applyRoundLoss(d[j]);
    } else {
      d[j].record.w += 1;
      applyRoundLoss(d[i]);
      const tmp = d[i]; d[i] = d[j]; d[j] = tmp; // upset moves them up the ladder
    }
  }
  return d;
}

// Picks who you fight next out of the real division, based on where you stand.
// Higher rank = you face people nearer the top.
// avoidIds (optional): opponent ids faced in the last few fights -- reroll a
// handful of times to dodge landing on the same person back-to-back by pure
// chance. Bounded, so a thin division can't spin forever, and never applies
// to the title-fight path (that's resolved by flag, not by this draw).
function selectDivisionOpponent(division, playerRankPoints, forTitle, avoidIds) {
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
  const centre = Math.round(span - (playerRankPoints / 100) * (span - 1));
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
  // The displayed Top 15 numbering excludes whoever is flagged champion.
  // Normally that's index 0, so array index and display rank line up
  // (target itself never dips into index 0 here). But during a vacant title
  // -- nobody in the division flagged, belt held by the player or open
  // after an interim -- there's no entry to exclude, so every displayed
  // rank sits one higher than its raw array index.
  const hasDivisionChampion = division.some((f) => f.isChampion);
  const displayRank = hasDivisionChampion ? target : target + 1;
  return {
    fighter: division[target],
    // Anything past DIVISION_SIZE is unranked -- report null so the UI shows
    // "unranked" rather than a fake #27 ranking.
    rank: displayRank <= DIVISION_SIZE ? displayRank : null,
  };
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
    playerRank: null,
    record: { w: 0, l: 0 }, finishes: { ko: 0, sub: 0, dec: 0 },
    rankPoints: 0, peakRankPoints: 0, rankedFightCount: 0,
    circuitTier: circuitTierFor(0, false),
    careerStyle: (options && options.careerStyle) || "Balanced",
    styleIsNaturalFit: !!(options && options.careerStyle
      && options.careerStyle !== "Balanced"
      && options.careerStyle === bestFitArchetypeFlat(base)),
    yearStartRank: 0, yearStartChampion: false, yearStartLegacy: 0, peakYearLegacy: 0,
    champion: false, titleReigns: 0, titleDefenses: 0,
    streak: 0, longestStreak: 0,
    wear: { chin: 0, speed: 0 }, weightPenaltyFightsLeft: 0,
    runningLegacy: 0, oppQualitySumWins: 0, statementWins: 0, rivalryWins: 0,
    rivals: [], recentOpponentIds: [], definingLoss: null,
    yearFocusAttr: null, yearStance: "balanced", campQuality: "full", mediaBuff: null,
    wonTitleAsUnderdog: false,
    timeline: [
      { type: "styleSelected", id: "style-select",
        style: (options && options.careerStyle) || "Balanced",
        naturalFit: !!(options && options.careerStyle
          && options.careerStyle !== "Balanced"
          && options.careerStyle === bestFitArchetypeFlat(base)) },
      { type: "year", id: "y-1", year: 1 },
    ],
    fightGlobalIndex: 0,
    pendingDecision: { type: "campPlanning" },
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
  s.yearStartRank = state.rankPoints;
  s.yearStartChampion = state.champion;
  s.yearStartLegacy = state.runningLegacy;

  const effective = applyAging(s.base, s.year, s.wear);
  const riskMult = campQuality === "full" ? 0.55 : 1.35;
  const injury = rollInjury(effective, riskMult);
  let fightsThisYear = 2 + Math.floor(Math.random() * 3);
  if (s.year > 8) fightsThisYear = Math.max(1, fightsThisYear - 1);
  if (campQuality === "full") fightsThisYear = Math.max(1, fightsThisYear - 1);

  const timeline = [...s.timeline, { type: "campPlan", id: `plan-${s.year}`, year: s.year, focusAttr, campQuality, stance, rankSnapshot: state.rankPoints }];
  let champion = s.champion;
  if (injury) {
    s.wear = { chin: s.wear.chin + (injury.major ? 3 : 1), speed: s.wear.speed + (injury.major ? 3 : 1) };
    if (injury.major) {
      fightsThisYear = 0;
      timeline.push({ type: "injury", id: `inj-${s.year}`, major: true });
      if (champion) { champion = false; timeline.push({ type: "interim", id: `int-${s.year}` }); }
    } else {
      fightsThisYear = Math.max(1, fightsThisYear - 1);
      timeline.push({ type: "injury", id: `inj-${s.year}`, major: false });
    }
  }

  s.champion = champion;

  // Optional light weight-class move: brief adjustment penalty, then normal.
  if (s.weightPenaltyFightsLeft <= 0 && Math.random() < 0.05) {
    const direction = Math.random() < 0.5 ? "up" : "down";
    s.weightPenaltyFightsLeft = 2;
    timeline.push({ type: "weightMove", id: `wm-${s.year}`, direction });
  }

  s.timeline = timeline;
  s.fightsRemainingThisYear = fightsThisYear;
  s.pendingDecision = null;
  return s;
}

// Rare, non-fight decision points. Capped chances so they feel special
// rather than constant, and title fights always skip straight to the fight.
function maybeFightChoice(state) {
  const wouldBeTitle = state.champion || (!state.champion && state.streak >= 4 && state.rankPoints >= 70);
  if (wouldBeTitle) return runFight(state, "default");
  const roll = Math.random();
  if (roll < 0.22) return { ...state, pendingDecision: { type: "fightChoice" } };
  if (roll < 0.30) return { ...state, pendingDecision: { type: "trainingEvent", attr: pickWeakestSkill(state.base) } };
  if (roll < 0.36) return { ...state, pendingDecision: { type: "mediaEvent" } };
  return runFight(state, "default");
}

function pickWeakestSkill(base) {
  let worst = { key: "STRIKING", value: 999 };
  SKILL_KEYS.forEach((k) => { if (base[k] < worst.value) worst = { key: k, value: base[k] }; });
  return worst.key;
}

// A permanent, modest improvement if the player chooses to address the gap.
function resolveTrainingEvent(state, attr, addressed) {
  const s = { ...state };
  if (addressed) s.base = { ...s.base, [attr]: clamp(s.base[attr] + 3, 30, 99) };
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

// ---- Simulated fight statistics (broadcast-style breakdown) ---------------
// Everything here is derived from the same player/opponent attributes and
// phase-control split the real engine already computed for this fight --
// nothing is independently random-flavored. Generated once when the fight
// resolves (inside runFight) and stored on the timeline entry, so it's
// stable across re-renders rather than recomputed on every paint.
function generateFightStats(player, opp, phase, result, totalRounds) {
  const sigStrikesFor = (a) => Math.max(1, Math.round(phase.standShare * 14 * (a.STRIKING / 80) * (0.7 + a.CARDIO / 300) * totalRounds));
  const takedownsFor = (a) => Math.max(0, Math.round(phase.groundShare * 2.4 * (a.WRESTLING / 80) * totalRounds));

  const pControlShare = clamp(0.5 + (player.WRESTLING - opp.WRESTLING) / 200, 0.1, 0.9);

  let pKD = 0, oKD = 0;
  if (result.method === "KO/TKO") pKD = 1;
  else if (result.method === "KO/TKO Loss") oKD = 1;
  else {
    if (player.POWER >= 82 && Math.random() < 0.16) pKD = 1;
    if (opp.POWER >= 82 && Math.random() < 0.16) oKD = 1;
  }

  const isFinish = result.method.startsWith("KO/TKO") || result.method.startsWith("Submission");
  const dominance = clamp(Math.abs(result.winProb - 0.5) * 2, 0, 1); // 0 = coin flip, 1 = dominant
  let finishRound = null, finishTime = null, scorecards = null;

  if (isFinish) {
    // Higher dominance skews the roll toward earlier rounds.
    const roll = Math.pow(Math.random(), 1 + dominance * 2);
    finishRound = clamp(Math.ceil(roll * totalRounds), 1, totalRounds);
    // A clock time within that round, so results read like a real result line.
    const secs = Math.floor(Math.random() * 299) + 1;
    finishTime = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  } else {
    scorecards = [0, 1, 2].map(() => {
      let playerRoundsWon = 0;
      for (let r = 0; r < totalRounds; r++) {
        const roundWinProb = result.win ? 0.55 + dominance * 0.35 : 0.45 - dominance * 0.35;
        if (Math.random() < roundWinProb) playerRoundsWon++;
      }
      // Simplified scoring: every round is a 10-9, no 10-8s/10-10s.
      return { player: 10 * totalRounds - (totalRounds - playerRoundsWon), opp: 10 * totalRounds - playerRoundsWon };
    });
  }

  return {
    totalRounds, finishRound, finishTime, scorecards,
    player: { sigStrikes: sigStrikesFor(player), takedowns: takedownsFor(player), controlPct: Math.round(phase.groundShare * 100 * pControlShare), knockdowns: pKD },
    opp: { sigStrikes: sigStrikesFor(opp), takedowns: takedownsFor(opp), controlPct: Math.round(phase.groundShare * 100 * (1 - pControlShare)), knockdowns: oKD },
  };
}

function runFight(state, choiceTag) {
  const s = { ...state };
  s.fightGlobalIndex += 1;

  const isTitleShot = (!s.champion && s.streak >= 4 && s.rankPoints >= 70) || choiceTag === "shortNoticeTitle" || choiceTag === "demandShot";
  const isTitleDefense = s.champion;
  const isTitleFight = isTitleShot || isTitleDefense;

  // Draw the opponent from the persistent division: a real fighter with a
  // standing record, not a throwaway profile. An active rival can be drawn
  // for a rematch -- but only an ACTIVE one: re-validate every rival against
  // the player's current strength before considering a redraw, so a rival
  // from years-outgrown tiers stops being reachable instead of getting
  // rebooked against a PREMIER-tier fighter forever.
  const agedNow = applyAging(s.base, s.year, s.wear);
  const playerOverallNow = Math.round(SKILL_KEYS.reduce((sum, k) => sum + agedNow[k], 0) / SKILL_KEYS.length);
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
  const picked = drawRival
    ? { fighter: rivalEntry, rank: s.divisionRoster.indexOf(rivalEntry) }
    : selectDivisionOpponent(s.divisionRoster, s.rankPoints, isTitleFight, s.recentOpponentIds);
  const oppEntry = picked.fighter;
  const oppName = oppEntry.name;
  const oppRank = picked.rank;
  const opp = { attrs: oppEntry.attrs, overall: oppEntry.overall, archetype: oppEntry.archetype, traits: oppEntry.traits };
  const oppRecord = oppEntry.record;
  const existingRival = s.rivals.find((r) => r.id === oppEntry.id);
  const isRivalFight = !!(existingRival && existingRival.isRival);

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
    effective = { ...effective, [s.yearFocusAttr]: clamp(effective[s.yearFocusAttr] + 4, 30, 99) };
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

  const tierBefore = s.circuitTier;
  const stanceBias = s.yearStance === "ground" ? 0.08 : s.yearStance === "standup" ? -0.08 : 0;
  const result = resolveFight(effective, s.reachScore, opp.attrs, stanceBias, playerTraits, opp.traits);
  const totalRounds = isTitleFight ? 5 : 3;
  // Computed here (rather than inline in the timeline push below) so the
  // performance-bonus check below can read finishRound/scorecards before
  // legacyDelta is finalized.
  const stats = generateFightStats(effective, opp.attrs, result.phase, result, totalRounds);

  if (result.win) {
    s.record = { ...s.record, w: s.record.w + 1 };
    s.streak += 1;
    s.longestStreak = Math.max(s.longestStreak, s.streak);
    if (result.method === "KO/TKO") s.finishes = { ...s.finishes, ko: s.finishes.ko + 1 };
    else if (result.method === "Submission") s.finishes = { ...s.finishes, sub: s.finishes.sub + 1 };
    else s.finishes = { ...s.finishes, dec: s.finishes.dec + 1 };
    s.oppQualitySumWins += opp.overall;
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

  s.rankPoints = updateRanking(s.rankPoints, result.win, opp.overall, isTitleFight);
  s.peakRankPoints = Math.max(s.peakRankPoints, s.rankPoints);
  if (s.rankPoints >= 40) s.rankedFightCount += 1;

  if (isTitleShot && result.win) {
    s.titleReigns += 1;
    s.champion = true;
    if (s.record.l >= 2) s.wonTitleAsUnderdog = true;
  }
  if (isTitleDefense) {
    if (result.win) s.titleDefenses += 1;
    else s.champion = false;
  }

  s.circuitTier = circuitTierFor(s.rankPoints, s.champion);
  const tierChanged = s.circuitTier !== tierBefore;

  // --- update the persistent division ---------------------------------
  // Your opponent's record changes from fighting you, then the rest of the
  // division fights among itself so the standings move while you're away.
  let nextDivision = s.divisionRoster.map((f) => (
    f.id === oppEntry.id
      ? { ...f, record: { w: f.record.w + (result.win ? 0 : 1), l: f.record.l + (result.win ? 1 : 0) } }
      : f
  ));
  // Beating someone ranked above you takes their spot.
  if (result.win && oppRank > 0 && s.playerRank != null && oppRank < s.playerRank) {
    s.playerRank = oppRank;
  } else if (result.win && s.playerRank == null) {
    s.playerRank = Math.max(1, oppRank);
  } else if (!result.win && s.playerRank != null) {
    s.playerRank = Math.min(DIVISION_SIZE, s.playerRank + 1);
  }
  if (isTitleShot && result.win) {
    // You took the belt -- clear isChampion off the old champ (found by
    // flag, not position) so they fall back into the ranked pool as a
    // normal contender with their real record intact. The player's own
    // champion status lives on career state (s.champion), never as a
    // divisionRoster entry, so rankings render must check that flag first.
    nextDivision = nextDivision.map((f) => (f.isChampion ? { ...f, isChampion: false } : f));
    s.playerRank = 0;
  } else if (isTitleDefense && !result.win) {
    // You lost the belt -- the opponent who just beat you becomes champion.
    // (s.playerRank already moved to 1 above, same as any other title loss.)
    nextDivision = nextDivision.map((f) => (f.id === oppEntry.id ? { ...f, isChampion: true } : f));
  }
  s.divisionRoster = simulateDivisionRound(nextDivision);

  // A rivalry is earned: 2+ meetings, at least one of them genuinely
  // competitive. Tracked as a proper record per opponent (id-keyed, not
  // name equality) so multiple rivals can be active at once, each with
  // their own meeting count and head-to-head record.
  const fightWasClose = isCloseFight(result.method, result.winProb);
  const rivalIdx = s.rivals.findIndex((r) => r.id === oppEntry.id);
  let rivalryJustBorn = false;
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
  const isRivalry = !!(rivalRecord && rivalRecord.isRival && rivalRecord.active);
  s.recentOpponentIds = [oppEntry.id, ...(s.recentOpponentIds || [])].slice(0, 2);
  const isStatement = result.win && opp.overall >= 88;
  if (isStatement) s.statementWins += 1;
  if (isRivalry && result.win) s.rivalryWins += 1;

  // Performance bonuses, UFC-style: a genuinely emphatic round-1 finish
  // earns "Performance of the Night" (win-only -- you have to finish it);
  // a real nail-biter that goes the distance earns "Fight of the Night"
  // regardless of who won, since that one is about the fight, not the
  // result. This sim's finish rate runs high (most finishes land inside
  // the first two rounds), so gating on finish round alone would hand a
  // bonus to roughly half of all fights -- a badge that common stops
  // meaning anything. Requiring round 1 AND a decisive winProb gap (not
  // just "isCloseFight"'s wider rivalry-detection band) keeps both bonuses
  // reserved for the fights that actually stood out.
  const dominance = Math.abs(result.winProb - 0.5) * 2; // 0 = coin flip, 1 = lopsided
  const isEmphaticFinish = stats.finishRound === 1 && dominance >= 0.55;
  const isNailBiter = stats.finishRound == null && Math.abs(result.winProb - 0.5) <= 0.12;
  const bonusType = (result.win && isEmphaticFinish) ? "performance" : (isNailBiter ? "fotn" : null);

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
  } else {
    legacyDelta = result.method === "KO/TKO Loss" ? -6 : result.method === "Submission Loss" ? -5 : -3;
    if (isTitleDefense) legacyDelta -= 4;
    if (isTitleShot) legacyDelta -= choiceTag === "shortNoticeTitle" ? 6 : choiceTag === "demandShot" ? 3 : 2;
    // A Fight of the Night loss is still a loss, but a hard-fought war
    // shouldn't sting exactly as much as a listless decision loss does.
    if (bonusType === "fotn") legacyDelta += 3;

    const severity = (isTitleDefense ? 100 : 0) + opp.overall;
    if (!s.definingLoss || severity > s.definingLoss.severity) {
      s.definingLoss = {
        severity, oppName, oppRating: opp.overall, wasTitle: isTitleDefense,
        fightSnapshot: { effective, reachScore: s.reachScore, oppAttrs: opp.attrs, stanceBias, playerTraits, oppTraits: opp.traits },
      };
    }
  }
  s.runningLegacy = Math.max(0, s.runningLegacy + legacyDelta);

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
  const cardPosition = isTitleFight
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
    circuitTier: s.circuitTier, eventNumber, cardPosition,
    onStyle: s.careerStyle && s.careerStyle !== "Balanced" ? s.styleIsNaturalFit : null,
    win: result.win, method: result.method,
    titleShot: isTitleShot, titleDefense: isTitleDefense, shortNotice: choiceTag === "shortNoticeTitle", demanded: choiceTag === "demandShot",
    rivalry: isRivalry, statement: isStatement, bonusType, interview,
    // Raw rankPoints/champion flags, not labels -- rankLabel() renders these
    // at display time, same convention as yearEnd's rankBefore/rankAfter.
    rankBefore: rankPointsBefore, championBefore, rankAfter: s.rankPoints, championAfter: s.champion,
    matchup: result.matchup, narrative: result.narrative, playerTraits,
    stats,
  });
  s.timeline = timeline;

  s.fightsRemainingThisYear -= 1;
  if (s.weightPenaltyFightsLeft > 0) s.weightPenaltyFightsLeft -= 1;
  s.mediaBuff = null;
  s.pendingDecision = null;
  return s;
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
function summarizeYear(timeline, yearStartRank, yearStartChampion, rankNow, championNow) {
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
  const verdict = verdictFor(legacyScore);
  // The last year in progress never goes through advanceCareer's yearEnd
  // branch (finishCareerState fires in its place), so its legacy gain has
  // to be folded into peakYearLegacy here too, the same way, or a career
  // that peaks in its final year would never register that peak.
  const finalYearGain = Math.max(0, state.runningLegacy - state.yearStartLegacy);
  const peakYearLegacy = Math.max(state.peakYearLegacy || 0, finalYearGain);
  const timeline = [...state.timeline,
    { type: "retirement", id: "retirement", line: retirementLine(state.record, verdict) },
    {
      type: "summary", id: "summary",
      finishRate: Math.round(finishRate * 100), strengthOfSchedule: Math.round(strengthOfSchedule),
      peakRankPoints: state.peakRankPoints, rankedFightCount: state.rankedFightCount,
      statementWins: state.statementWins, rivalryWins: state.rivalryWins, bonus,
      peakYearLegacy, yearsActive: state.year, topWins: topCareerWins(state.timeline),
    },
  ];
  return { ...state, timeline, finished: true, legacyScore, verdict, totalFightCount, peakYearLegacy };
}

function advanceCareer(state) {
  if (state.finished || state.pendingDecision) return state;
  if (state.fightsRemainingThisYear > 0) return maybeFightChoice(state);
  if (state.year >= state.totalYears) return finishCareerState(state);
  const yearSummary = summarizeYear(state.timeline, state.yearStartRank, state.yearStartChampion, state.rankPoints, state.champion);
  // How much Legacy Score this year alone was worth -- kept as a running
  // peak so "Legacy Score" (the whole career, uneven years and all) and
  // "Best Year" (your single best stretch) can be shown side by side at
  // retirement instead of one number hiding the other.
  const yearLegacyGain = Math.max(0, state.runningLegacy - state.yearStartLegacy);
  const s = { ...state, year: state.year + 1, peakYearLegacy: Math.max(state.peakYearLegacy || 0, yearLegacyGain) };
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
      } else if (s.pendingDecision.type === "trainingEvent") {
        s = resolveTrainingEvent(s, s.pendingDecision.attr, true);
      } else if (s.pendingDecision.type === "mediaEvent") {
        s = resolveMediaEvent(s, false);
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
  DIVISION_SIZE,
  STYLE_DESCRIPTIONS,
  TRAIT_DEFS,
  advanceCareer,
  applyAging,
  bestFitArchetypeFlat,
  buildDivision,
  calculateLegacy,
  circuitTierFor,
  clfTier,
  computeAchievements,
  computePlayerProfile,
  computeWinProbability,
  deriveTraits,
  estimatePhaseControl,
  fastForwardCareer,
  generateOpponentProfile,
  initCareer,
  maybeFightChoice,
  metaRankFor,
  phaseWeightedOutput,
  playSfxForTransition,
  rankLabel,
  rankToTierCls,
  resolveCampPlanning,
  resolveFight,
  resolveMediaEvent,
  resolveTrainingEvent,
  runFight,
  verdictFor,
};
