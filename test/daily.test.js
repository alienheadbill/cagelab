import test from "node:test";
import assert from "node:assert/strict";

import { canStartDaily, dailyAttemptState } from "../src/lib/daily.js";

const TODAY = "2026-10-07";

test("Daily is available when neither an attempt nor completion exists today", () => {
  assert.equal(dailyAttemptState({}, TODAY), "available");
  assert.equal(canStartDaily({}, TODAY), true);

  const yesterday = {
    attemptedDate: "2026-10-06",
    lastCompletedDate: "2026-10-06",
  };
  assert.equal(dailyAttemptState(yesterday, TODAY), "available");
  assert.equal(canStartDaily(yesterday, TODAY), true);
});

test("starting but abandoning Daily consumes today's attempt", () => {
  const stats = { attemptedDate: TODAY, lastCompletedDate: null };

  assert.equal(dailyAttemptState(stats, TODAY), "attempted");
  assert.equal(canStartDaily(stats, TODAY), false);
});

test("completing Daily consumes today's attempt", () => {
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
