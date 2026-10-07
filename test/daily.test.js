import test from "node:test";
import assert from "node:assert/strict";

import {
  DAILY_RULES_VERSION,
  canStartDaily,
  dailyAttemptState,
  isCanonicalIsoDate,
  normalizeDailyAssignment,
  previousIsoDate,
} from "../src/lib/daily.js";

const TODAY = "2026-10-07";

test("Daily is unavailable without an authoritative challenge date", () => {
  assert.equal(dailyAttemptState({}, null), "unavailable");
  assert.equal(canStartDaily({}, null), false);
});

test("Daily is available when neither an attempt nor completion exists for the authoritative date", () => {
  assert.equal(dailyAttemptState({}, TODAY), "available");
  assert.equal(canStartDaily({}, TODAY), true);

  const yesterday = {
    attemptedDate: "2026-10-06",
    lastCompletedDate: "2026-10-06",
  };
  assert.equal(dailyAttemptState(yesterday, TODAY), "available");
  assert.equal(canStartDaily(yesterday, TODAY), true);
});

test("starting but abandoning Daily consumes the authoritative date's attempt", () => {
  const stats = { attemptedDate: TODAY, lastCompletedDate: null };

  assert.equal(dailyAttemptState(stats, TODAY), "attempted");
  assert.equal(canStartDaily(stats, TODAY), false);
});

test("completing Daily consumes the authoritative date's attempt", () => {
  const stats = {
    attemptedDate: TODAY,
    lastCompletedDate: TODAY,
    lastScore: 88,
  };

  assert.equal(dailyAttemptState(stats, TODAY), "completed");
  assert.equal(canStartDaily(stats, TODAY), false);
});

test("completion wins over attempted state for presentation", () => {
  const stats = {
    attemptedDate: TODAY,
    lastCompletedDate: TODAY,
  };

  assert.equal(dailyAttemptState(stats, TODAY), "completed");
});

test("canonical ISO date validation rejects rollover dates and malformed input", () => {
  assert.equal(isCanonicalIsoDate("2026-10-07"), true);
  assert.equal(isCanonicalIsoDate("2024-02-29"), true);
  assert.equal(isCanonicalIsoDate("2026-02-29"), false);
  assert.equal(isCanonicalIsoDate("2026-13-01"), false);
  assert.equal(isCanonicalIsoDate("10/07/2026"), false);
  assert.equal(isCanonicalIsoDate(null), false);
});

test("normalizes a supported authoritative RPC row", () => {
  assert.deepEqual(
    normalizeDailyAssignment({
      challenge_date: TODAY,
      fixture_id: "card-2024-001-r1",
      rules_version: DAILY_RULES_VERSION,
      seed: 1210255544,
    }),
    {
      ok: true,
      assignment: {
        challengeDate: TODAY,
        fixtureId: "card-2024-001-r1",
        rulesVersion: DAILY_RULES_VERSION,
        seed: 1210255544,
      },
    }
  );
});

test("rejects stale or malformed authoritative assignments", () => {
  assert.equal(normalizeDailyAssignment(null).reason, "missing-assignment");
  assert.equal(normalizeDailyAssignment({
    challenge_date: "2026-02-31",
    fixture_id: "card-2024-001-r1",
    rules_version: DAILY_RULES_VERSION,
    seed: 1,
  }).reason, "invalid-date");
  assert.equal(normalizeDailyAssignment({
    challenge_date: TODAY,
    fixture_id: "",
    rules_version: DAILY_RULES_VERSION,
    seed: 1,
  }).reason, "invalid-fixture");
  assert.equal(normalizeDailyAssignment({
    challenge_date: TODAY,
    fixture_id: "card-2024-001-r1",
    rules_version: "fight-card-v2",
    seed: 1,
  }).reason, "unsupported-rules");
  assert.equal(normalizeDailyAssignment({
    challenge_date: TODAY,
    fixture_id: "card-2024-001-r1",
    rules_version: DAILY_RULES_VERSION,
    seed: -1,
  }).reason, "invalid-seed");
});

test("previousIsoDate follows UTC calendar arithmetic", () => {
  assert.equal(previousIsoDate("2026-10-07"), "2026-10-06");
  assert.equal(previousIsoDate("2026-03-01"), "2026-02-28");
  assert.equal(previousIsoDate("2024-03-01"), "2024-02-29");
  assert.equal(previousIsoDate("2026-01-01"), "2025-12-31");
  assert.equal(previousIsoDate("invalid"), null);
});
