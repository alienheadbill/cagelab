import test from "node:test";
import assert from "node:assert/strict";

import { restoreSavedBuildDraftState } from "../src/lib/builds.js";

test("restores a saved build's own division after reload", () => {
  const restored = restoreSavedBuildDraftState({
    fighterName: "TEST FIGHTER",
    mode: "blind",
    goatScore: 87,
    division: "Middleweight",
    picks: [
      {
        key: "STRIKING",
        fighter: "Example Fighter",
        display: "92",
        scoreValue: 92,
        raw: 92,
      },
    ],
  });

  assert.equal(restored.division, "Middleweight");
  assert.equal(restored.fighterName, "TEST FIGHTER");
  assert.equal(restored.mode, "blind");
  assert.equal(restored.goatScore, 87);
  assert.deepEqual(restored.picks.STRIKING, {
    fighter: "Example Fighter",
    display: "92",
    scoreValue: 92,
    raw: 92,
  });
});

test("preserves optional Fight Card provenance when present", () => {
  const restored = restoreSavedBuildDraftState({
    division: "Welterweight",
    picks: [
      {
        key: "HEIGHT",
        fighter: "Card Fighter",
        display: "6'1\"",
        scoreValue: 88,
        raw: 73,
        sourceCardFighterId: "cf-2024-002-05",
      },
    ],
  });

  assert.equal(
    restored.picks.HEIGHT.sourceCardFighterId,
    "cf-2024-002-05"
  );
});

test("old saves without division retain the legacy null fallback contract", () => {
  const restored = restoreSavedBuildDraftState({
    fighterName: "OLD SAVE",
    goatScore: 0,
    picks: [],
  });

  assert.equal(restored.division, null);
  assert.equal(restored.mode, "classic");
  assert.equal(restored.goatScore, 0);
});


test("preserves authoritative Daily metadata on saved build restoration", () => {
  const dailyMeta = {
    challengeDate: "2026-10-07",
    fixtureId: "card-2024-001-r1",
    rulesVersion: "fight-card-v1",
  };

  const restored = restoreSavedBuildDraftState({
    mode: "daily",
    division: "Lightweight",
    dailyMeta,
    picks: [],
  });

  assert.deepEqual(restored.dailyMeta, dailyMeta);
});

test("old saved builds restore no fabricated Daily metadata", () => {
  const restored = restoreSavedBuildDraftState({
    mode: "daily",
    division: "Lightweight",
    picks: [],
  });

  assert.equal(restored.dailyMeta, null);
});
