import test from "node:test";
import assert from "node:assert/strict";

import { buildPlaybackScript, momentumToPercent, beatDurationMs } from "../src/lib/fightPlayback.js";

// Minimal hand-authored round fixture matching simulateRounds' real shape
// (career.js:192-201) -- not derived from any RNG, so every value here is
// exact and reproducible.
function round(overrides) {
  return {
    round: 1, playerWon: true, margin: 0.1,
    playerSig: 10, oppSig: 8, playerTD: 0, oppTD: 0,
    playerFatigue: 0, oppFatigue: 0,
    playerDamage: 0, oppDamage: 0,
    outputGap: 0, nearFinish: false, finishThisRound: false, groundHeavy: false,
    ...overrides,
  };
}

test("buildPlaybackScript returns one beat per round, in round order", () => {
  const rounds = [round({ round: 1 }), round({ round: 2 }), round({ round: 3 })];
  const narratives = ["r1 text", "r2 text", "r3 text"];
  const { beats } = buildPlaybackScript(rounds, narratives, []);

  assert.equal(beats.length, 3);
  assert.deepEqual(beats.map((b) => b.round), [1, 2, 3]);
  assert.deepEqual(beats.map((b) => b.narrative), narratives);
});

test("momentum is outputGap/22 and clamps at +-1 beyond saturation", () => {
  const rounds = [
    round({ round: 1, outputGap: 11 }),   // 0.5
    round({ round: 2, outputGap: -11 }),  // -0.5
    round({ round: 3, outputGap: 100 }),  // clamp to 1
    round({ round: 4, outputGap: -100 }), // clamp to -1
    round({ round: 5, outputGap: 0 }),    // dead even
  ];
  const { beats } = buildPlaybackScript(rounds, ["", "", "", "", ""], []);

  assert.equal(beats[0].momentum, 0.5);
  assert.equal(beats[1].momentum, -0.5);
  assert.equal(beats[2].momentum, 1);
  assert.equal(beats[3].momentum, -1);
  assert.equal(beats[4].momentum, 0);
});

test("flipped mirrors narrative.js's existing momentum-flip rule, including the round-1 guard", () => {
  // Round 1 has a huge gap, but isFirst must suppress a flip regardless.
  const rounds = [
    round({ round: 1, outputGap: 20 }),
    round({ round: 2, outputGap: -20 }), // sign flip from round 1's average, |gap| > 3 -> flipped
    round({ round: 3, outputGap: -5 }),  // same sign as prior avg -> not flipped
    round({ round: 4, outputGap: 2 }),   // sign flips but |gap| <= 3 -> not flipped
  ];
  const { beats } = buildPlaybackScript(rounds, ["", "", "", ""], []);

  assert.equal(beats[0].flipped, false, "round 1 can never be a flip");
  assert.equal(beats[1].flipped, true);
  assert.equal(beats[2].flipped, false);
  assert.equal(beats[3].flipped, false);
});

test("intensity buckets at the 6/14 outputGap boundaries", () => {
  const rounds = [
    round({ round: 1, outputGap: 5.9 }),
    round({ round: 2, outputGap: 6 }),
    round({ round: 3, outputGap: 13.9 }),
    round({ round: 4, outputGap: 14 }),
    round({ round: 5, outputGap: -14 }),
  ];
  const { beats } = buildPlaybackScript(rounds, ["", "", "", "", ""], []);

  assert.equal(beats[0].intensity, "low");
  assert.equal(beats[1].intensity, "medium");
  assert.equal(beats[2].intensity, "medium");
  assert.equal(beats[3].intensity, "high");
  assert.equal(beats[4].intensity, "high", "intensity is magnitude-based, sign-agnostic");
});

test("a finish round's beat carries finishThisRound; rounds[] is already truncated there by simulateRounds", () => {
  const rounds = [round({ round: 1 }), round({ round: 2, finishThisRound: true, playerWon: true })];
  const { beats } = buildPlaybackScript(rounds, ["", ""], []);

  assert.equal(beats.length, 2);
  assert.equal(beats[1].finishThisRound, true);
});

test("round-attributed moments land on that beat; whole-fight moments land in fightArcMoments, not on any beat", () => {
  const rounds = [round({ round: 1 }), round({ round: 2 })];
  const moments = [
    { round: 2, type: "danger-opp", label: "OPPONENT ROCKED", text: "..." },
    { round: null, type: "comeback", label: "COMEBACK", text: "..." },
  ];
  const { beats, fightArcMoments } = buildPlaybackScript(rounds, ["", ""], moments);

  assert.deepEqual(beats[0].moments, []);
  assert.deepEqual(beats[1].moments, [moments[0]]);
  assert.deepEqual(fightArcMoments, [moments[1]]);
});

test("momentumToPercent maps -1/0/1 to 0/50/100", () => {
  assert.equal(momentumToPercent(-1), 0);
  assert.equal(momentumToPercent(0), 50);
  assert.equal(momentumToPercent(1), 100);
});

test("beatDurationMs: finish > nearFinish > flipped > plain, as documented constants", () => {
  const plain = beatDurationMs({});
  const flipped = beatDurationMs({ flipped: true });
  const nearFinish = beatDurationMs({ nearFinish: true });
  const finish = beatDurationMs({ finishThisRound: true });

  assert.equal(plain, 1200);
  assert.equal(flipped, 1700);
  assert.equal(nearFinish, 2000);
  assert.equal(finish, 2600);
  assert.ok(finish > nearFinish && nearFinish > flipped && flipped > plain);
});

test("buildPlaybackScript tolerates an empty rounds array", () => {
  const { beats, fightArcMoments } = buildPlaybackScript([], [], []);
  assert.deepEqual(beats, []);
  assert.deepEqual(fightArcMoments, []);
});
