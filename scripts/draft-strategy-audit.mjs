import { fileURLToPath } from "node:url";

import { SKILL_KEYS, WEIGHT_CLASSES, erasForClass, CLASS_PHYSICALS } from "../src/data/attrs.js";
import { MASTER_FIGHTERS, boardFor } from "../src/data/fighters.js";
import { listFightCardFixtures } from "../src/data/fightCards.js";
import { boardForFightCard } from "../src/lib/fightCardDraft.js";
import { mulberry32 } from "../src/lib/rng.js";
import { computeFightPreview, deriveTraits } from "../src/lib/career.js";
import {
  computeBuildValueBreakdown,
  relativeHeightScore,
  relativeReachScore,
} from "../src/lib/scoring.js";

const STANCE_BIASES = [-0.08, 0, 0.08];
const EPSILON = 1e-10;

function skillsFromFighter(fighter) {
  return Object.fromEntries(SKILL_KEYS.map((key) => [key, fighter[key]]));
}

function sampleEvenly(items, count, offset = 0) {
  const take = Math.min(count, items.length);
  const result = [];
  const used = new Set();

  for (let i = 0; i < take; i += 1) {
    let index = Math.floor((i * items.length) / take + offset) % items.length;
    while (used.has(index)) index = (index + 1) % items.length;
    used.add(index);
    result.push(items[index]);
  }
  return result;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function round(value, places = 6) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function pearson(xs, ys) {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let numerator = 0;
  let xSq = 0;
  let ySq = 0;

  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    numerator += dx * dy;
    xSq += dx * dx;
    ySq += dy * dy;
  }

  const denom = Math.sqrt(xSq * ySq);
  return denom ? numerator / denom : null;
}

function traitsChanged(before, after) {
  return before.length !== after.length
    || before.some((trait, index) => trait !== after[index]);
}

function runDraftStrategyAudit(options = {}) {
  const {
    contextCount = 24,
    opponentCount = 32,
    boardsPerCell = 16,
    boardsPerFixture = 32,
  } = options;

  const contexts = sampleEvenly(MASTER_FIGHTERS, contextCount, 3);
  const opponents = sampleEvenly(MASTER_FIGHTERS, opponentCount, 11).map((fighter) => ({
    id: fighter.id,
    skills: skillsFromFighter(fighter),
    traits: deriveTraits(skillsFromFighter(fighter)),
  }));

  const utilityCache = new Map();

  function combatUtility(build, reachScore = 75) {
    const playerTraits = deriveTraits(build);
    let sum = 0;

    for (const opponent of opponents) {
      let best = -Infinity;
      for (const stanceBias of STANCE_BIASES) {
        const preview = computeFightPreview(
          build,
          reachScore,
          opponent.skills,
          stanceBias,
          playerTraits,
          opponent.traits,
        );
        best = Math.max(best, preview.winProb);
      }
      sum += best;
    }

    return sum / opponents.length;
  }

  function utilityForValue(context, attrKey, value) {
    const cacheKey = `${context.id}|${attrKey}|${value}`;
    if (utilityCache.has(cacheKey)) return utilityCache.get(cacheKey);
    const build = skillsFromFighter(context);
    build[attrKey] = value;
    const utility = combatUtility(build, 75);
    utilityCache.set(cacheKey, utility);
    return utility;
  }

  const monotonicity = Object.fromEntries(SKILL_KEYS.map((key) => [key, {
    comparisons: 0,
    decreases: 0,
    examples: [],
  }]));

  for (const context of contexts) {
    for (const attrKey of SKILL_KEYS) {
      for (let value = 50; value < 99; value += 1) {
        const before = utilityForValue(context, attrKey, value);
        const after = utilityForValue(context, attrKey, value + 1);
        monotonicity[attrKey].comparisons += 1;

        if (after + EPSILON < before) {
          monotonicity[attrKey].decreases += 1;
          if (monotonicity[attrKey].examples.length < 4) {
            const beforeBuild = skillsFromFighter(context);
            const afterBuild = skillsFromFighter(context);
            beforeBuild[attrKey] = value;
            afterBuild[attrKey] = value + 1;
            const beforeTraits = deriveTraits(beforeBuild);
            const afterTraits = deriveTraits(afterBuild);

            monotonicity[attrKey].examples.push({
              context: context.n,
              from: value,
              to: value + 1,
              utilityBefore: round(before),
              utilityAfter: round(after),
              delta: round(after - before),
              beforeTraits,
              afterTraits,
              traitChange: traitsChanged(beforeTraits, afterTraits),
            });
          }
        }
      }
    }
  }

  function freshBoardStats() {
    return Object.fromEntries(SKILL_KEYS.map((key) => [key, {
      boards: 0,
      tieForRawHighest: 0,
      rawHighestAlsoCombatBest: 0,
      strictLowerCombatBest: 0,
      averageSpreadAccumulator: 0,
      examples: [],
    }]));
  }

  function evaluateBoard(modeStats, board, context, attrKey, label) {
    const rows = board.map((fighter) => ({
      fighter: fighter.n || fighter.displayName || fighter.id,
      value: fighter[attrKey],
      utility: utilityForValue(context, attrKey, fighter[attrKey]),
    }));

    const maxRaw = Math.max(...rows.map((row) => row.value));
    const maxUtility = Math.max(...rows.map((row) => row.utility));
    const maxRawUtility = Math.max(...rows.filter((row) => row.value === maxRaw).map((row) => row.utility));
    const rawHighestRows = rows.filter((row) => row.value === maxRaw);
    const lowerBetter = rows.filter(
      (row) => row.value < maxRaw && row.utility > maxRawUtility + EPSILON,
    );

    const stat = modeStats[attrKey];
    stat.boards += 1;
    stat.averageSpreadAccumulator += maxRaw - Math.min(...rows.map((row) => row.value));
    if (rawHighestRows.length > 1) stat.tieForRawHighest += 1;
    if (rawHighestRows.some((row) => row.utility >= maxUtility - EPSILON)) {
      stat.rawHighestAlsoCombatBest += 1;
    }
    if (lowerBetter.length > 0) {
      stat.strictLowerCombatBest += 1;
      if (stat.examples.length < 4) {
        stat.examples.push({
          board: label,
          context: context.n,
          maxRaw,
          rawHighestUtility: round(maxRawUtility),
          betterLowerOptions: lowerBetter
            .sort((a, b) => b.utility - a.utility)
            .slice(0, 3)
            .map((row) => ({
              fighter: row.fighter,
              value: row.value,
              utility: round(row.utility),
            })),
          contextTraitsAtMaxRaw: deriveTraits({
            ...skillsFromFighter(context),
            [attrKey]: maxRaw,
          }),
        });
      }
    }
  }

  const classic = freshBoardStats();
  let classicBoardIndex = 0;
  for (const wc of WEIGHT_CLASSES) {
    for (const era of erasForClass(wc)) {
      for (let boardIndex = 0; boardIndex < boardsPerCell; boardIndex += 1) {
        const seed = 100000 + classicBoardIndex * 1000 + boardIndex;
        const board = boardFor(wc, era, mulberry32(seed));
        const context = contexts[(classicBoardIndex + boardIndex) % contexts.length];
        for (const attrKey of SKILL_KEYS) {
          evaluateBoard(classic, board, context, attrKey, `${wc}/${era}/${boardIndex}`);
        }
      }
      classicBoardIndex += 1;
    }
  }

  const daily = freshBoardStats();
  const fixtures = listFightCardFixtures();
  fixtures.forEach((fixture, fixtureIndex) => {
    for (let boardIndex = 0; boardIndex < boardsPerFixture; boardIndex += 1) {
      const seed = 900000 + fixtureIndex * 10000 + boardIndex;
      const board = boardForFightCard(fixture, mulberry32(seed));
      const context = contexts[(fixtureIndex * boardsPerFixture + boardIndex) % contexts.length];
      for (const attrKey of SKILL_KEYS) {
        evaluateBoard(daily, board, context, attrKey, `${fixture.id}/${boardIndex}`);
      }
    }
  });

  function finalizeBoardStats(stats) {
    return Object.fromEntries(SKILL_KEYS.map((key) => {
      const stat = stats[key];
      return [key, {
        boards: stat.boards,
        averageOfferedSpread: round(stat.averageSpreadAccumulator / stat.boards, 3),
        tieForRawHighestRate: round(stat.tieForRawHighest / stat.boards, 4),
        rawHighestAlsoCombatBestRate: round(stat.rawHighestAlsoCombatBest / stat.boards, 4),
        strictLowerCombatBestRate: round(stat.strictLowerCombatBest / stat.boards, 4),
        examples: stat.examples,
      }];
    }));
  }

  const marginalCombatValue = {};
  for (const attrKey of SKILL_KEYS) {
    const deltas = [];
    for (const context of contexts) {
      const current = context[attrKey];
      const next = Math.min(99, current + 5);
      if (next === current) continue;
      const before = utilityForValue(context, attrKey, current);
      const after = utilityForValue(context, attrKey, next);
      deltas.push((after - before) / (next - current));
    }
    marginalCombatValue[attrKey] = round(mean(deltas));
  }

  const reachDeltas = contexts.map((context) => {
    const build = skillsFromFighter(context);
    return combatUtility(build, 99) - combatUtility(build, 50);
  });

  const heightRanges = WEIGHT_CLASSES.map((wc) => {
    const midpoint = CLASS_PHYSICALS[wc].ht;
    return {
      weightClass: wc,
      shortScore: relativeHeightScore(midpoint - 3, wc),
      midpointScore: relativeHeightScore(midpoint, wc),
      tallScore: relativeHeightScore(midpoint + 3, wc),
    };
  });

  const reachRanges = WEIGHT_CLASSES.map((wc) => {
    const midpoint = CLASS_PHYSICALS[wc].rc;
    return {
      weightClass: wc,
      shortScore: relativeReachScore(midpoint - 3, wc),
      midpointScore: relativeReachScore(midpoint, wc),
      longScore: relativeReachScore(midpoint + 3, wc),
    };
  });

  const rosterBuildValues = MASTER_FIGHTERS.map((fighter) => {
    const picks = Object.fromEntries(
      SKILL_KEYS.map((key) => [key, { scoreValue: fighter[key] }]),
    );
    const skillAverage = mean(SKILL_KEYS.map((key) => fighter[key]));
    return {
      fighter: fighter.n,
      skillAverage,
      buildValue: computeBuildValueBreakdown(picks).buildValue,
    };
  });

  const averageBins = new Map();
  for (const row of rosterBuildValues) {
    const bin = Math.floor(row.skillAverage / 2) * 2;
    if (!averageBins.has(bin)) averageBins.set(bin, []);
    averageBins.get(bin).push(row);
  }

  const comparableBins = [...averageBins.entries()]
    .filter(([, rows]) => rows.length >= 5)
    .map(([bin, rows]) => {
      const values = rows.map((row) => row.buildValue);
      return {
        averageBin: bin,
        fighters: rows.length,
        buildValueMin: Math.min(...values),
        buildValueMax: Math.max(...values),
        spread: Math.max(...values) - Math.min(...values),
      };
    })
    .sort((a, b) => b.spread - a.spread);

  const nonMonotonicAttrs = SKILL_KEYS
    .filter((key) => monotonicity[key].decreases > 0);

  return {
    methodology: {
      contextCount: contexts.length,
      opponentCount: opponents.length,
      stancesPerOpponent: STANCE_BIASES.length,
      classicBoardsPerWeightEraCell: boardsPerCell,
      dailyBoardsPerFixture: boardsPerFixture,
      fixtureCount: fixtures.length,
      note: "Combat utility = average best pre-fight win probability across the sampled opponent set, allowing the player to choose stand-up, balanced, or ground gameplan. Only the tested attribute changes; all other skill values come from the sampled real-roster context.",
    },
    structuralFindings: {
      fixedAttributeRoundObservation: "When a choice transfers only one rating and that rating is monotonic in combat, the higher rating weakly dominates the lower rating. Build fit alone cannot reverse the choice without a real secondary tradeoff or non-monotonic rule.",
      heightFeedsCombat: false,
      reachFeedsCombat: true,
      buildQualitiesAddHiddenBonus: false,
      nonMonotonicAttributes: nonMonotonicAttrs,
    },
    monotonicity: Object.fromEntries(SKILL_KEYS.map((key) => [key, {
      comparisons: monotonicity[key].comparisons,
      decreases: monotonicity[key].decreases,
      decreaseRate: round(monotonicity[key].decreases / monotonicity[key].comparisons, 6),
      examples: monotonicity[key].examples,
    }])),
    boards: {
      classic: finalizeBoardStats(classic),
      daily: finalizeBoardStats(daily),
    },
    marginalCombatValuePerRatingPoint: marginalCombatValue,
    physicals: {
      height: {
        combatDeltaShortToTall: 0,
        normalizedScoreExamples: heightRanges,
        note: "Height is not an input to computeFightPreview/resolveFight; changing Height alone cannot change fight performance under the current engine.",
      },
      reach: {
        averageCombatUtilityDeltaScore50To99: round(mean(reachDeltas)),
        normalizedScoreExamples: reachRanges,
        note: "Reach enters win probability as (reachScore - 75) / 700. It is monotonic and currently measured against a neutral 75 baseline rather than opponent reach.",
      },
    },
    buildValue: {
      rosterCorrelationWithSkillAverage: round(pearson(
        rosterBuildValues.map((row) => row.skillAverage),
        rosterBuildValues.map((row) => row.buildValue),
      )),
      widestSpreadAtSimilarSkillAverage: comparableBins.slice(0, 8),
      note: "Build Value reads phase-weighted offensive shape, so this checks whether specialization creates signal beyond raw average on existing roster profiles.",
    },
  };
}

export { runDraftStrategyAudit };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(runDraftStrategyAudit(), null, 2));
}
