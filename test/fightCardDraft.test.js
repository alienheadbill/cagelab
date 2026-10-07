import test from "node:test";
import assert from "node:assert/strict";

import { SKILL_KEYS, WEIGHT_CLASSES } from "../src/data/attrs.js";
import {
  getFightCardFixture,
  getRepresentedDivisions,
  listFightCardFixtures,
} from "../src/data/fightCards.js";
import { BOARD_SIZE } from "../src/data/fighters.js";
import {
  adaptCardFighterToBoardItem,
  boardForFightCard,
  boardForPhysicalPool,
  eraFromAppearanceId,
  resolveLateWeight,
  resolvePhysicalPool,
} from "../src/lib/fightCardDraft.js";
import { mulberry32, shuffle } from "../src/lib/rng.js";

function simulateDailySequence(seed, fixtureId = "card-2024-001-r1") {
  const rng = mulberry32(seed);
  const fixture = getFightCardFixture(fixtureId);
  assert.ok(fixture, `missing fixture ${fixtureId}`);

  // fight-card-v1 starts gameplay RNG HERE. Fixture identity is supplied by
  // the authoritative server assignment and consumes no client RNG draw.
  const skillOrder = shuffle(SKILL_KEYS, rng);

  const skillBoards = Array.from({ length: SKILL_KEYS.length }, () =>
    boardForFightCard(fixture, rng).map((fighter) => fighter.id)
  );

  const targetDivision = resolveLateWeight(fixture, rng);
  const physicalPool = resolvePhysicalPool(fixture, targetDivision);
  const heightBoard = boardForPhysicalPool(physicalPool, rng).map((fighter) => fighter.id);
  const reachBoard = boardForPhysicalPool(physicalPool, rng).map((fighter) => fighter.id);

  return {
    fixtureId: fixture.id,
    skillOrder,
    skillBoards,
    targetDivision,
    heightBoard,
    reachBoard,
  };
}

test("same authoritative fixture + seed produces the exact same fight-card-v1 gameplay sequence", () => {
  for (const seed of [1, 42, 20261007, 8675309, 2147483647]) {
    assert.deepEqual(simulateDailySequence(seed), simulateDailySequence(seed));
  }
});

test("different seeds produce legitimate sequence variation", () => {
  const outputs = new Set(
    Array.from({ length: 25 }, (_, seed) =>
      JSON.stringify(simulateDailySequence(seed + 1))
    )
  );

  assert.ok(outputs.size > 1);
});

test("skill rounds only offer fighters from the selected fixture and never duplicate a board slot", () => {
  for (const fixture of listFightCardFixtures()) {
    const eligibleIds = new Set(fixture.cardFighters.map((fighter) => fighter.id));

    for (const seed of [3, 11, 29, 101]) {
      const rng = mulberry32(seed);
      const board = boardForFightCard(fixture, rng);
      const ids = board.map((fighter) => fighter.id);

      assert.equal(board.length, Math.min(BOARD_SIZE, fixture.cardFighters.length));
      assert.equal(new Set(ids).size, ids.length);
      assert.ok(ids.every((id) => eligibleIds.has(id)));
      assert.ok(board.every((fighter) => fighter.sourceCardFighterId === fighter.id));
    }
  }
});

test("late weight always resolves to a represented supported division", () => {
  for (const fixture of listFightCardFixtures()) {
    const represented = new Set(getRepresentedDivisions(fixture));

    for (let seed = 1; seed <= 500; seed += 1) {
      const division = resolveLateWeight(fixture, mulberry32(seed));
      assert.ok(represented.has(division));
      assert.ok(WEIGHT_CLASSES.includes(division));
    }
  }
});

test("all represented divisions remain reachable across seeded late-weight rolls", () => {
  for (const fixture of listFightCardFixtures()) {
    const expected = new Set(getRepresentedDivisions(fixture));
    const seen = new Set();

    for (let seed = 1; seed <= 5000 && seen.size < expected.size; seed += 1) {
      seen.add(resolveLateWeight(fixture, mulberry32(seed)));
    }

    assert.deepEqual([...seen].sort(), [...expected].sort());
  }
});

test("physical pool is restricted to target plus immediately adjacent supported divisions", () => {
  for (const fixture of listFightCardFixtures()) {
    for (const target of WEIGHT_CLASSES) {
      const targetIndex = WEIGHT_CLASSES.indexOf(target);
      const allowed = new Set(
        [WEIGHT_CLASSES[targetIndex - 1], target, WEIGHT_CLASSES[targetIndex + 1]].filter(Boolean)
      );
      const pool = resolvePhysicalPool(fixture, target);

      assert.ok(pool.every((fighter) => allowed.has(fighter.division)));
      assert.ok(pool.every((fighter) => fixture.cardFighters.includes(fighter)));
    }
  }

  assert.deepEqual(resolvePhysicalPool(listFightCardFixtures()[0], "Not A Division"), []);
});

test("thin physical pools are shuffled but never padded or duplicated", () => {
  const fixture = getFightCardFixture("card-2024-003-r1");
  const pool = resolvePhysicalPool(fixture, "Heavyweight");

  assert.equal(pool.length, 2);

  const orders = new Set();
  for (let seed = 1; seed <= 100; seed += 1) {
    const board = boardForPhysicalPool(pool, mulberry32(seed));
    const ids = board.map((fighter) => fighter.id);

    assert.equal(board.length, 2);
    assert.equal(new Set(ids).size, 2);
    assert.deepEqual([...ids].sort(), pool.map((fighter) => fighter.id).sort());
    orders.add(ids.join(","));
  }

  assert.equal(orders.size, 2);
});

test("physical boards preserve fighter provenance and never rewrite source division", () => {
  const fixture = getFightCardFixture("card-2024-002-r1");
  const pool = resolvePhysicalPool(fixture, "Middleweight");
  const board = boardForPhysicalPool(pool, mulberry32(99));

  for (const fighter of board) {
    const source = fixture.cardFighters.find((candidate) => candidate.id === fighter.id);
    assert.ok(source);
    assert.equal(fighter.sourceCardFighterId, source.id);
    assert.equal(fighter.wc, source.division);
  }
});

test("adapter maps immutable fixture data into the existing draft-card shape", () => {
  const source = listFightCardFixtures()[0].cardFighters[0];
  const adapted = adaptCardFighterToBoardItem(source);

  assert.equal(adapted.id, source.id);
  assert.equal(adapted.n, source.displayName);
  assert.equal(adapted.wc, source.division);
  assert.equal(adapted.ht, source.attributes.HEIGHT);
  assert.equal(adapted.rc, source.attributes.REACH);
  assert.equal(adapted.sourceCardFighterId, source.id);

  for (const key of SKILL_KEYS) {
    assert.equal(adapted[key], source.attributes[key]);
  }
});

test("appearance-era parsing is presentation-only and degrades safely", () => {
  assert.equal(eraFromAppearanceId("fighter-lightweight-2010s"), "2010s");
  assert.equal(eraFromAppearanceId("fighter-heavyweight-2020s"), "2020s");
  assert.equal(eraFromAppearanceId("malformed"), "");
  assert.equal(eraFromAppearanceId(null), "");
});

test("live C2 assignment pins the fight-card-v1 RNG sequence", () => {
  const sequence = simulateDailySequence(1210255544, "card-2024-001-r1");

  assert.deepEqual(sequence, {
    fixtureId: "card-2024-001-r1",
    skillOrder: [
      "IQ",
      "STRIKING",
      "SPEED",
      "WRESTLING",
      "CARDIO",
      "CHIN",
      "GRAPPLING",
      "POWER",
    ],
    skillBoards: [
      ["cf-2024-001-04", "cf-2024-001-08", "cf-2024-001-06", "cf-2024-001-05", "cf-2024-001-07"],
      ["cf-2024-001-04", "cf-2024-001-08", "cf-2024-001-05", "cf-2024-001-01", "cf-2024-001-02"],
      ["cf-2024-001-06", "cf-2024-001-02", "cf-2024-001-08", "cf-2024-001-05", "cf-2024-001-04"],
      ["cf-2024-001-03", "cf-2024-001-05", "cf-2024-001-04", "cf-2024-001-08", "cf-2024-001-01"],
      ["cf-2024-001-02", "cf-2024-001-03", "cf-2024-001-04", "cf-2024-001-06", "cf-2024-001-01"],
      ["cf-2024-001-07", "cf-2024-001-06", "cf-2024-001-04", "cf-2024-001-05", "cf-2024-001-01"],
      ["cf-2024-001-02", "cf-2024-001-01", "cf-2024-001-06", "cf-2024-001-08", "cf-2024-001-03"],
      ["cf-2024-001-04", "cf-2024-001-03", "cf-2024-001-06", "cf-2024-001-02", "cf-2024-001-01"],
    ],
    targetDivision: "Lightweight",
    heightBoard: [
      "cf-2024-001-07",
      "cf-2024-001-01",
      "cf-2024-001-02",
      "cf-2024-001-04",
      "cf-2024-001-08",
    ],
    reachBoard: [
      "cf-2024-001-01",
      "cf-2024-001-02",
      "cf-2024-001-07",
      "cf-2024-001-03",
      "cf-2024-001-06",
    ],
  });
});
