import test from "node:test";
import assert from "node:assert/strict";

import { buildFightStory, identifyMoments, howItHappened, momentumFlipped } from "../src/lib/narrative.js";

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

// momentumFlipped was extracted out of scoreReasons's inline check with no
// intended behavior change -- this is the exact truth table that inline
// expression had to satisfy before the extraction, now pinned directly.
test("momentumFlipped: round 1 (isFirst) is never a flip, regardless of magnitude", () => {
  assert.equal(momentumFlipped(50, [], true), false);
  assert.equal(momentumFlipped(-50, [10], true), false);
});

test("momentumFlipped: requires a real sign disagreement with the trailing average", () => {
  assert.equal(momentumFlipped(10, [8], false), false, "same sign as prior average -- no flip");
  assert.equal(momentumFlipped(-10, [8], false), true, "opposite sign, magnitude > 3 -- a flip");
  assert.equal(momentumFlipped(10, [-8], false), true);
});

test("momentumFlipped: magnitude threshold is a strict > 3, and zero signs never count as a flip", () => {
  assert.equal(momentumFlipped(3, [-8], false), false, "exactly at the threshold -- not a flip");
  assert.equal(momentumFlipped(3.01, [-8], false), true);
  assert.equal(momentumFlipped(0, [-8], false), false, "zero gap has no sign to flip");
  assert.equal(momentumFlipped(10, [0], false), false, "a zero prior average has no sign to flip against");
});

test("momentumFlipped: trailing average is the last 2 prior rounds, not the whole history", () => {
  // Average of [-20, -20] = -20 (negative); a +10 this round disagrees -> flip.
  assert.equal(momentumFlipped(10, [50, -20, -20], false), true);
  // Average of [] (no prior rounds yet) is treated as 0 -- no sign to flip against.
  assert.equal(momentumFlipped(10, [], false), false);
});

// Regression smoke test: the extraction must not change buildFightStory/
// identifyMoments/howItHappened's own observable behavior -- they still run
// end-to-end, in the right shape, on a fixture that exercises a real
// momentum swing (and nothing here was previously covered by any test).
test("buildFightStory/identifyMoments/howItHappened still run end-to-end after the extraction", () => {
  const rounds = [
    round({ round: 1, playerWon: true, outputGap: 15 }),
    round({ round: 2, playerWon: false, outputGap: -15, nearFinish: true }),
    round({ round: 3, playerWon: true, outputGap: 12, finishThisRound: true }),
  ];

  const narratives = buildFightStory(rounds, "KO/TKO");
  assert.equal(narratives.length, rounds.length);
  narratives.forEach((text) => assert.equal(typeof text, "string"));
  assert.ok(narratives.every((t) => t.length > 0));

  const moments = identifyMoments(rounds, false, false, 3, "KO/TKO", true);
  assert.ok(Array.isArray(moments));
  assert.ok(moments.some((m) => m.type === "finish" && m.round === 3));

  const summary = howItHappened(rounds, true, "KO/TKO", 3);
  assert.equal(typeof summary, "string");
  assert.ok(summary.length > 0);
});
