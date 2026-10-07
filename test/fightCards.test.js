import test from "node:test";
import assert from "node:assert/strict";

import {
  FIGHT_CARD_FIXTURES,
  getCardFightersForDivision,
  getFightCardFixture,
  getRepresentedDivisions,
  listFightCardFixtures,
  validateFightCardFixture,
} from "../src/data/fightCards.js";

test("all shipped Fight Card fixtures satisfy the validator", () => {
  assert.ok(FIGHT_CARD_FIXTURES.length > 0);

  for (const fixture of FIGHT_CARD_FIXTURES) {
    const result = validateFightCardFixture(fixture);
    assert.equal(result.valid, true, result.errors.join("\n"));
    assert.deepEqual(result.errors, []);
  }
});

test("fixture ids are unique and lookup is stable", () => {
  const ids = FIGHT_CARD_FIXTURES.map((fixture) => fixture.id);

  assert.equal(new Set(ids).size, ids.length);
  for (const fixture of FIGHT_CARD_FIXTURES) {
    assert.equal(getFightCardFixture(fixture.id), fixture);
  }
  assert.equal(getFightCardFixture("missing-fixture"), null);
});

test("published fixture data is frozen at every contract boundary", () => {
  assert.equal(Object.isFrozen(listFightCardFixtures()), true);

  for (const fixture of FIGHT_CARD_FIXTURES) {
    assert.equal(Object.isFrozen(fixture), true);
    assert.equal(Object.isFrozen(fixture.cardFighters), true);
    assert.equal(Object.isFrozen(fixture.bouts), true);

    for (const fighter of fixture.cardFighters) {
      assert.equal(Object.isFrozen(fighter), true);
      assert.equal(Object.isFrozen(fighter.attributes), true);
    }

    for (const bout of fixture.bouts) {
      assert.equal(Object.isFrozen(bout), true);
    }
  }
});

test("represented-division and fighter lookup helpers agree with fixture data", () => {
  for (const fixture of FIGHT_CARD_FIXTURES) {
    const divisions = getRepresentedDivisions(fixture);
    assert.ok(divisions.length > 0);

    for (const division of divisions) {
      const fighters = getCardFightersForDivision(fixture.id, division);
      assert.ok(fighters.length > 0);
      assert.ok(fighters.every((fighter) => fighter.division === division));
    }
  }
});

test("validator rejects unsupported sources and dangling bout references", () => {
  const base = FIGHT_CARD_FIXTURES[0];

  const badSource = { ...base, source: "historical" };
  const sourceResult = validateFightCardFixture(badSource);
  assert.equal(sourceResult.valid, false);
  assert.ok(sourceResult.errors.some((error) => error.includes("unsupported source")));

  const badBout = {
    ...base,
    bouts: [
      { ...base.bouts[0], fighterAId: "missing-card-fighter" },
      ...base.bouts.slice(1),
    ],
  };
  const boutResult = validateFightCardFixture(badBout);
  assert.equal(boutResult.valid, false);
  assert.ok(boutResult.errors.some((error) => error.includes("not found in cardFighters")));
});
