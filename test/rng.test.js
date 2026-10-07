import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeSeed,
  encodeSeed,
  mulberry32,
  seedFromDateStr,
  shuffle,
} from "../src/lib/rng.js";

test("mulberry32 produces the same sequence for the same seed", () => {
  const a = mulberry32(123456);
  const b = mulberry32(123456);

  const seqA = Array.from({ length: 20 }, () => a());
  const seqB = Array.from({ length: 20 }, () => b());

  assert.deepEqual(seqA, seqB);
});

test("different seeds produce different sequences", () => {
  const a = mulberry32(1);
  const b = mulberry32(2);

  const seqA = Array.from({ length: 10 }, () => a());
  const seqB = Array.from({ length: 10 }, () => b());

  assert.notDeepEqual(seqA, seqB);
});

test("shuffle is deterministic with a seeded rng and does not mutate input", () => {
  const input = ["a", "b", "c", "d", "e", "f"];
  const original = [...input];

  const first = shuffle(input, mulberry32(98765));
  const second = shuffle(input, mulberry32(98765));

  assert.deepEqual(first, second);
  assert.deepEqual(input, original);
  assert.deepEqual([...first].sort(), [...input].sort());
});

test("date strings seed consistently", () => {
  assert.equal(seedFromDateStr("2026-10-07"), seedFromDateStr("2026-10-07"));
  assert.notEqual(seedFromDateStr("2026-10-07"), seedFromDateStr("2026-10-08"));
});

test("challenge seed encoding round-trips non-negative seeds", () => {
  for (const seed of [0, 1, 42, 123456789, 2147483647]) {
    assert.equal(decodeSeed(encodeSeed(seed)), seed);
  }
});
