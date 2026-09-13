// =========================================================================
//  FIGHT CARD DAILY V2 -- Phase A: Fixture Foundation
//  Independent, self-contained "card" data for the future Fight Card Daily
//  mode ("build a fighter out of everyone who competed on this card").
//  This module is intentionally isolated from Career's `universe.events`,
//  the Daily leaderboard, Draft state, and Supabase -- nothing here is
//  wired into gameplay yet.
//
//  Immutability contract:
//  - A fixture's `id` is a specific, immutable revision (`card-YYYY-NNN-rN`).
//    A future correction to a fixture's data is a NEW id with an
//    incremented `-rN` suffix, never an edit of an existing one.
//  - `schemaVersion` is a separate concept from the revision suffix: it
//    describes the shape of the fixture record itself, not which cut of
//    the card this is. Do not conflate the two.
//  - Every fixture below is a frozen, fully self-contained snapshot.
//    CardFighter records copy the relevant fields off MASTER_FIGHTERS at
//    authoring time (see snapshotCardFighter below); nothing exported from
//    this file reads MASTER_FIGHTERS at query time, and there is no
//    runtime fuzzy-matching or fallback lookup. MASTER_FIGHTERS itself is
//    never modified by this module.
//
//  Provenance (Phase A): the three fixtures below are marked
//  `source: "development"` -- they are synthetic development fixtures
//  assembled from MASTER_FIGHTERS's existing (already-fictionalized-in-
//  rating, real-name) roster, not claims about any real historical event,
//  date, or card. They must not be presented as historical fact anywhere
//  in the product. Real historical fixtures (`source: "historical"` or
//  similar) are gated behind the unresolved legal/provenance question
//  tracked in CAGELAB_ROADMAP.md (Fight Card Daily Phase 2/2B findings)
//  and are NOT introduced here.
//
//  UNRESOLVED FOR LATER PHASE: how authoritative UTC-date -> fixture
//  assignment is generated without letting whichever client/deployment
//  happens to run first define the day's fixture. A UNIQUE(date)
//  constraint on a client-driven insert is NOT sufficient on its own --
//  it guarantees only one stored row, not that the row reflects a
//  server-authoritative choice, so a race between clients could still let
//  an arbitrary browser pick the day's fixture. Candidate approaches
//  (pre-populated assignments, a server/RPC-side assignment, or
//  deterministic assignment against an explicitly versioned immutable
//  published fixture pool) are deferred to a later phase. Nothing in this
//  file assumes or implements any of them -- there is no date logic, no
//  Supabase reference, and no `getDailyFixtureForDate`-style lookup here.
// =========================================================================
import { MASTER_FIGHTERS } from "./fighters.js";
import { SKILL_KEYS, WEIGHT_CLASSES } from "./attrs.js";

export const FIGHT_CARD_SCHEMA_VERSION = 1;

// The only source Phase A ever produces. Adding "historical"/"production"
// here is a later-phase, legal-gate-dependent decision -- do not add to
// this list casually.
export const FIGHT_CARD_SOURCES = ["development"];

// ---- authoring-time-only snapshot builders ------------------------------
// findMasterFighter/snapshotCardFighter run ONLY while the fixture literals
// below are being constructed, at module-evaluation time. Nothing exported
// from this file calls back into MASTER_FIGHTERS at query time -- every
// fixture is a frozen, fully self-contained snapshot by the time it's
// exported. Do not repurpose these as a runtime/fuzzy lookup path.
function findMasterFighter(name, wc, era) {
  const f = MASTER_FIGHTERS.find((m) => m.n === name && m.wc === wc && m.era === era);
  if (!f) {
    throw new Error(`fightCards fixture authoring: no MASTER_FIGHTERS entry for "${name}" (${wc}, ${era})`);
  }
  return f;
}

function snapshotCardFighter(cardFighterId, name, wc, era) {
  const src = findMasterFighter(name, wc, era);
  return Object.freeze({
    id: cardFighterId,
    displayName: src.n,
    // MASTER_FIGHTERS' own (appearance-scoped, not person-scoped) id,
    // preserved verbatim for future cross-referencing.
    appearanceId: src.id,
    // Reserved for a future true cross-appearance/person identity.
    // Intentionally unimplemented in Phase A.
    personId: null,
    division: src.wc,
    attributes: Object.freeze({
      STRIKING: src.STRIKING,
      GRAPPLING: src.GRAPPLING,
      WRESTLING: src.WRESTLING,
      CARDIO: src.CARDIO,
      POWER: src.POWER,
      CHIN: src.CHIN,
      SPEED: src.SPEED,
      IQ: src.IQ,
      HEIGHT: src.ht,
      REACH: src.rc,
    }),
  });
}

function bout(order, division, fighterAId, fighterBId, status = "scheduled") {
  return Object.freeze({ order, division, fighterAId, fighterBId, status });
}

function fixture({ id, source, label, cardFighters, bouts }) {
  return Object.freeze({
    id,
    schemaVersion: FIGHT_CARD_SCHEMA_VERSION,
    source,
    label,
    cardFighters: Object.freeze(cardFighters),
    bouts: Object.freeze(bouts),
  });
}

// ---- Development fixture 1: single-division depth card ------------------
// A thick same-division pool -- 4 bouts, 8 distinct Lightweight/2010s
// fighters. Baseline case for later per-division pool-size logic.
const FIXTURE_LIGHTWEIGHT_DEPTH = fixture({
  id: "card-2024-001-r1",
  source: "development",
  label: "Development Fixture -- Lightweight Depth Card",
  cardFighters: [
    snapshotCardFighter("cf-2024-001-01", "Dustin Poirier", "Lightweight", "2010s"),
    snapshotCardFighter("cf-2024-001-02", "James Krause", "Lightweight", "2010s"),
    snapshotCardFighter("cf-2024-001-03", "Dan Hooker", "Lightweight", "2010s"),
    snapshotCardFighter("cf-2024-001-04", "Donald Cerrone", "Lightweight", "2010s"),
    snapshotCardFighter("cf-2024-001-05", "Rashid Magomedov", "Lightweight", "2010s"),
    snapshotCardFighter("cf-2024-001-06", "Tony Ferguson", "Lightweight", "2010s"),
    snapshotCardFighter("cf-2024-001-07", "Khabib Nurmagomedov", "Lightweight", "2010s"),
    snapshotCardFighter("cf-2024-001-08", "Gregor Gillespie", "Lightweight", "2010s"),
  ],
  bouts: [
    bout(1, "Lightweight", "cf-2024-001-07", "cf-2024-001-08"),
    bout(2, "Lightweight", "cf-2024-001-01", "cf-2024-001-02"),
    bout(3, "Lightweight", "cf-2024-001-03", "cf-2024-001-04"),
    bout(4, "Lightweight", "cf-2024-001-05", "cf-2024-001-06"),
  ],
});

// ---- Development fixture 2: cross-division card --------------------------
// 5 bouts, 5 different divisions, 2 fighters each -- exercises the
// "represented divisions" helper and multi-division bout ordering.
const FIXTURE_CROSS_DIVISION = fixture({
  id: "card-2024-002-r1",
  source: "development",
  label: "Development Fixture -- Cross-Division Card",
  cardFighters: [
    snapshotCardFighter("cf-2024-002-01", "Tom Aspinall", "Heavyweight", "2020s"),
    snapshotCardFighter("cf-2024-002-02", "Ciryl Gane", "Heavyweight", "2020s"),
    snapshotCardFighter("cf-2024-002-03", "Sean O'Malley", "Bantamweight", "2020s"),
    snapshotCardFighter("cf-2024-002-04", "Petr Yan", "Bantamweight", "2020s"),
    snapshotCardFighter("cf-2024-002-05", "Uros Medic", "Welterweight", "2020s"),
    snapshotCardFighter("cf-2024-002-06", "Daniel Rodriguez", "Welterweight", "2020s"),
    snapshotCardFighter("cf-2024-002-07", "Shara Magomedov", "Middleweight", "2020s"),
    snapshotCardFighter("cf-2024-002-08", "Paulo Costa", "Middleweight", "2020s"),
    snapshotCardFighter("cf-2024-002-09", "Alexander Volkanovski", "Featherweight", "2020s"),
    snapshotCardFighter("cf-2024-002-10", "Billy Quarantillo", "Featherweight", "2020s"),
  ],
  bouts: [
    bout(1, "Heavyweight", "cf-2024-002-01", "cf-2024-002-02"),
    bout(2, "Bantamweight", "cf-2024-002-03", "cf-2024-002-04"),
    bout(3, "Welterweight", "cf-2024-002-05", "cf-2024-002-06"),
    bout(4, "Middleweight", "cf-2024-002-07", "cf-2024-002-08"),
    bout(5, "Featherweight", "cf-2024-002-09", "cf-2024-002-10"),
  ],
});

// ---- Development fixture 3: thin-pool card --------------------------
// Mostly Welterweight (3 bouts, 6 fighters) plus a single Heavyweight
// outlier bout -- that division has only 2 card-fighters on this fixture,
// deliberately thin. Exists to give future target+adjacent-division
// physical-eligibility logic a realistic case where the exact-division
// pool already on the card is too small to draw from.
const FIXTURE_THIN_POOL = fixture({
  id: "card-2024-003-r1",
  source: "development",
  label: "Development Fixture -- Thin Pool Card",
  cardFighters: [
    snapshotCardFighter("cf-2024-003-01", "Jack Della Maddalena", "Welterweight", "2020s"),
    snapshotCardFighter("cf-2024-003-02", "Rinat Fakhretdinov", "Welterweight", "2020s"),
    snapshotCardFighter("cf-2024-003-03", "Geoff Neal", "Welterweight", "2020s"),
    snapshotCardFighter("cf-2024-003-04", "Carlos Prates", "Welterweight", "2020s"),
    snapshotCardFighter("cf-2024-003-05", "Sean Brady", "Welterweight", "2020s"),
    snapshotCardFighter("cf-2024-003-06", "Gabriel Bonfim", "Welterweight", "2020s"),
    snapshotCardFighter("cf-2024-003-07", "Alexander Volkov", "Heavyweight", "2020s"),
    snapshotCardFighter("cf-2024-003-08", "Parker Porter", "Heavyweight", "2020s"),
  ],
  bouts: [
    bout(1, "Welterweight", "cf-2024-003-01", "cf-2024-003-02"),
    bout(2, "Welterweight", "cf-2024-003-03", "cf-2024-003-04"),
    bout(3, "Welterweight", "cf-2024-003-05", "cf-2024-003-06"),
    bout(4, "Heavyweight", "cf-2024-003-07", "cf-2024-003-08"),
  ],
});

const FIGHT_CARD_FIXTURES = Object.freeze([
  FIXTURE_LIGHTWEIGHT_DEPTH,
  FIXTURE_CROSS_DIVISION,
  FIXTURE_THIN_POOL,
]);

// ---- Strict validator -----------------------------------------------
// No repair, no silent omission -- any of these fail the fixture outright.
const REQUIRED_ATTRIBUTE_KEYS = [...SKILL_KEYS, "HEIGHT", "REACH"];
const VALID_BOUT_STATUSES = ["scheduled"];

function validateFightCardFixture(fx) {
  const errors = [];
  if (!fx || typeof fx !== "object") return { valid: false, errors: ["fixture is not an object"] };
  const label = fx.id || "(missing id)";

  if (!fx.id || typeof fx.id !== "string") errors.push(`${label}: missing/invalid id`);
  if (fx.schemaVersion !== FIGHT_CARD_SCHEMA_VERSION) {
    errors.push(`${label}: unsupported schemaVersion "${fx.schemaVersion}"`);
  }
  if (!FIGHT_CARD_SOURCES.includes(fx.source)) errors.push(`${label}: unsupported source "${fx.source}"`);
  if (!fx.label || typeof fx.label !== "string") errors.push(`${label}: missing/invalid label`);

  const fighterIds = new Set();
  if (!Array.isArray(fx.cardFighters) || fx.cardFighters.length === 0) {
    errors.push(`${label}: cardFighters must be a non-empty array`);
  } else {
    fx.cardFighters.forEach((cf, i) => {
      const tag = `${label} cardFighters[${i}]`;
      if (!cf || !cf.id || typeof cf.id !== "string") { errors.push(`${tag}: missing/invalid id`); return; }
      if (fighterIds.has(cf.id)) errors.push(`${label}: duplicate cardFighter id "${cf.id}"`);
      fighterIds.add(cf.id);
      if (!cf.displayName) errors.push(`${tag} (${cf.id}): missing displayName`);
      if (!WEIGHT_CLASSES.includes(cf.division)) errors.push(`${tag} (${cf.id}): invalid division "${cf.division}"`);
      if (!cf.attributes || typeof cf.attributes !== "object") {
        errors.push(`${tag} (${cf.id}): missing attributes`);
      } else {
        REQUIRED_ATTRIBUTE_KEYS.forEach((k) => {
          if (typeof cf.attributes[k] !== "number" || !Number.isFinite(cf.attributes[k])) {
            errors.push(`${tag} (${cf.id}): missing/invalid attribute "${k}"`);
          }
        });
      }
    });
  }

  if (!Array.isArray(fx.bouts) || fx.bouts.length === 0) {
    errors.push(`${label}: bouts must be a non-empty array`);
  } else {
    const seenOrders = new Set();
    fx.bouts.forEach((b, i) => {
      const tag = `${label} bouts[${i}]`;
      if (!b || typeof b.order !== "number" || !Number.isInteger(b.order) || b.order < 1) {
        errors.push(`${tag}: invalid order "${b && b.order}"`);
      } else if (seenOrders.has(b.order)) {
        errors.push(`${label}: duplicate bout order ${b.order}`);
      } else {
        seenOrders.add(b.order);
      }
      if (!b || !WEIGHT_CLASSES.includes(b.division)) errors.push(`${tag}: invalid division "${b && b.division}"`);
      if (!b || !VALID_BOUT_STATUSES.includes(b.status)) errors.push(`${tag}: invalid status "${b && b.status}"`);
      if (!b || !fighterIds.has(b.fighterAId)) errors.push(`${tag}: fighterAId "${b && b.fighterAId}" not found in cardFighters`);
      if (!b || !fighterIds.has(b.fighterBId)) errors.push(`${tag}: fighterBId "${b && b.fighterBId}" not found in cardFighters`);
      if (b && b.fighterAId === b.fighterBId) errors.push(`${tag}: fighterAId and fighterBId are the same fighter`);
    });
  }

  return { valid: errors.length === 0, errors };
}

function assertValidFightCardFixture(fx) {
  const { valid, errors } = validateFightCardFixture(fx);
  if (!valid) {
    throw new Error(`Invalid Fight Card fixture "${fx && fx.id}":\n  - ${errors.join("\n  - ")}`);
  }
}

// Fail loudly at import time -- a broken fixture must never ship silently.
FIGHT_CARD_FIXTURES.forEach(assertValidFightCardFixture);
(function assertUniqueFixtureIds() {
  const seen = new Set();
  FIGHT_CARD_FIXTURES.forEach((fx) => {
    if (seen.has(fx.id)) throw new Error(`Duplicate Fight Card fixture id "${fx.id}"`);
    seen.add(fx.id);
  });
})();

// ---- Minimal read-only lookup API -----------------------------------
// Deliberately does NOT include date logic, a Daily-assignment lookup, or
// any Supabase reference -- see the UNRESOLVED note at the top of this file.
function getFightCardFixture(id) {
  return FIGHT_CARD_FIXTURES.find((fx) => fx.id === id) || null;
}

function listFightCardFixtures() {
  return FIGHT_CARD_FIXTURES;
}

function resolveFixture(fixtureOrId) {
  return typeof fixtureOrId === "string" ? getFightCardFixture(fixtureOrId) : fixtureOrId;
}

function getRepresentedDivisions(fixtureOrId) {
  const fx = resolveFixture(fixtureOrId);
  if (!fx) return [];
  return Array.from(new Set(fx.bouts.map((b) => b.division)));
}

function getCardFightersForDivision(fixtureOrId, division) {
  const fx = resolveFixture(fixtureOrId);
  if (!fx) return [];
  return fx.cardFighters.filter((cf) => cf.division === division);
}

export {
  FIGHT_CARD_FIXTURES,
  getCardFightersForDivision,
  getFightCardFixture,
  getRepresentedDivisions,
  listFightCardFixtures,
  validateFightCardFixture,
};
